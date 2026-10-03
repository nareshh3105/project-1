/*
 * The WebCodecs recording engine.
 *
 * MediaRecorder hid its encoder and dropped frames at the start of every
 * recording. Reading frames off captureStream was no better: frames came in
 * pairs sharing one timestamp, and audio and video sat on different clocks.
 *
 * So this engine takes the timing into its own hands. Every frame and every
 * block of audio is stamped from ONE clock (performance.now), by the code that
 * produced it:
 *
 *   draw loop  -> VideoFrame(canvas, timestamp) -> VideoEncoder (H.264) --+
 *                                                                         +-> fragmented MP4
 *   mixed audio -> AudioWorklet (sample position) -> AudioEncoder (Opus) -+
 *
 * The audio position is exact, because the worklet reports the index of the
 * first sample in each block; it is mapped onto the shared clock once, from a
 * paired reading of the two clocks taken at the start.
 */
import { Muxer, StreamTarget } from './node_modules/mp4-muxer/build/mp4-muxer.mjs'

/** Default for how many frames may wait before the encoder counts as behind. */
const DEFAULT_MAX_QUEUE = 6

const SAMPLE_RATE = 48000

export async function createEngine({ canvas, ac, audioSource, sink, cfg, emit }) {
  const W = cfg.width
  const H = cfg.height
  const MAX_QUEUE = cfg.queue || DEFAULT_MAX_QUEUE

  // H.264 High profile; level 4.0 covers 1080p30, 4.2 covers 1080p60.
  const codec = cfg.fps > 30 ? 'avc1.64002A' : 'avc1.640028'
  const videoConfig = {
    codec,
    width: W,
    height: H,
    bitrate: cfg.bitrate,
    framerate: cfg.fps,
    latencyMode: 'realtime',
    hardwareAcceleration: cfg.hw || 'prefer-hardware',
    avc: { format: 'avc' },
  }

  const support = await VideoEncoder.isConfigSupported(videoConfig)
  if (!support.supported) throw new Error(`VideoEncoder does not support ${JSON.stringify(videoConfig)}`)

  const stats = {
    videoChunks: 0,
    audioChunks: 0,
    videoFramesIn: 0,
    videoFramesDropped: 0,
    encodeQueueMax: 0,
    keyframes: 0,
    nonSequentialWrites: 0,
    errors: [],
  }

  // ── Muxer, writing fragmented MP4 straight to the pipe ──
  let position = 0
  const muxer = new Muxer({
    target: new StreamTarget({
      chunked: false,
      onData: (data, pos) => {
        // Fragmented output should only ever append; count anything that doesn't.
        if (pos !== position) stats.nonSequentialWrites++
        position = pos + data.byteLength
        emit(data.slice().buffer)
      },
    }),
    video: { codec: 'avc', width: W, height: H, frameRate: cfg.fps },
    audio: { codec: 'opus', numberOfChannels: 2, sampleRate: SAMPLE_RATE },
    fastStart: 'fragmented',
    // Both tracks are already on one clock; keep their relative offset.
    firstTimestampBehavior: 'cross-track-offset',
  })

  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => {
      stats.videoChunks++
      if (chunk.type === 'key') stats.keyframes++
      muxer.addVideoChunk(chunk, meta)
    },
    error: (e) => stats.errors.push(`video: ${e}`),
  })
  videoEncoder.configure(videoConfig)

  const audioEncoder = new AudioEncoder({
    output: (chunk, meta) => {
      stats.audioChunks++
      muxer.addAudioChunk(chunk, meta)
    },
    error: (e) => stats.errors.push(`audio: ${e}`),
  })
  audioEncoder.configure({ codec: 'opus', sampleRate: SAMPLE_RATE, numberOfChannels: 2, bitrate: 160000 })

  // ── Audio capture ──
  await ac.audioWorklet.addModule('./capture-worklet.js')
  const worklet = new AudioWorkletNode(ac, 'capture', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  })
  audioSource.connect(worklet)
  worklet.connect(sink) // the sink pulls the graph; it is not audible

  let running = false
  let t0 = 0 // performance.now() at start; timestamps are measured from here
  let perfAnchor = 0
  let ctxAnchor = 0
  let frameN = 0
  const keyEvery = cfg.fps * 2 // a keyframe every two seconds, as streaming services expect

  // Diagnostics for a failure that only shows after several minutes.
  let audioMessages = 0
  let lastAudioMessageAt = performance.now()

  worklet.port.onmessage = (e) => {
    audioMessages++
    lastAudioMessageAt = performance.now()
    if (!running) return
    const { startFrame, frames, data } = e.data
    // Position of this block on the audio clock, carried onto the shared clock.
    const perfMs = perfAnchor + (startFrame / SAMPLE_RATE - ctxAnchor) * 1000
    const timestamp = Math.round((perfMs - t0) * 1000)
    if (timestamp < 0) return // before recording began
    const audio = new AudioData({
      format: 'f32-planar',
      sampleRate: SAMPLE_RATE,
      numberOfFrames: frames,
      numberOfChannels: 2,
      timestamp,
      data,
    })
    audioEncoder.encode(audio)
    // The encoder takes its own reference. Leaving this open leaks about
    // 0.4 MB/s and, after roughly seven and a half minutes, the audio stream
    // stops altogether while video carries on.
    audio.close()
  }

  return {
    mimeType: `webcodecs ${codec} + opus, fragmented mp4`,
    hardwareRequested: videoConfig.hardwareAcceleration,

    start() {
      // Read both clocks together to relate them. A pair is only as good as the
      // gap between its two reads, so take several and keep the tightest.
      let best = null
      for (let i = 0; i < 8; i++) {
        const p0 = performance.now()
        const c = ac.currentTime
        const p1 = performance.now()
        if (!best || p1 - p0 < best.width) best = { width: p1 - p0, perf: (p0 + p1) / 2, ctx: c }
      }
      perfAnchor = best.perf
      ctxAnchor = best.ctx
      t0 = performance.now()
      running = true
    },

    /** Called by the draw loop right after a frame is composed. */
    submitFrame(nowMs) {
      if (!running) return
      stats.videoFramesIn++
      stats.encodeQueueMax = Math.max(stats.encodeQueueMax, videoEncoder.encodeQueueSize)
      // Falling behind: drop a frame rather than let latency grow without limit.
      if (videoEncoder.encodeQueueSize > MAX_QUEUE) {
        stats.videoFramesDropped++
        return
      }
      const frame = new VideoFrame(canvas, { timestamp: Math.round((nowMs - t0) * 1000) })
      videoEncoder.encode(frame, { keyFrame: frameN % keyEvery === 0 })
      frame.close()
      frameN++
    },

    async stop() {
      running = false
      await videoEncoder.flush()
      await audioEncoder.flush()
      muxer.finalize()
      videoEncoder.close()
      audioEncoder.close()
    },

    stats: () => ({ ...stats }),

    /** The audio side's vital signs: if it stops, these say how. */
    diagnostics: () => ({
      acState: ac.state,
      acTime: ac.currentTime,
      audioMessages,
      silentForMs: performance.now() - lastAudioMessageAt,
      audioQueue: audioEncoder.encodeQueueSize,
      audioEncoderState: audioEncoder.state,
    }),
  }
}
