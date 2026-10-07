import type { SessionParams } from '../../shared/host'
import { AudioTimeline } from './audioClock'

/**
 * One output's encoder: composed frames and mixed audio in, a fragmented MP4
 * byte stream out.
 *
 * Every frame and every block of audio is stamped from ONE clock, the wall
 * clock, by the code that produced it. (MediaRecorder hid its encoder and
 * dropped frames; canvas.captureStream stamped frames in pairs on a different
 * clock from the audio. See docs/spikes/output-pipeline.md.)
 *
 * The browser pieces are injected so the timing and back-pressure rules can be
 * tested without a browser.
 */

export const SAMPLE_RATE = 48000
const CHANNELS = 2

/** The mix, the microphone alone, and everything but the microphone. */
export const MAX_TRACKS = 3

/** The fewest frames that may wait in the encoder before the output counts as behind. */
export const MAX_ENCODE_QUEUE = 30

/** How long the encoder gets, from the start, to come up to speed. */
export const WARMUP_MS = 2000

/**
 * How many frames may wait in the encoder before one is dropped.
 *
 * A hardware encoder takes a moment to start, and frames queue up meanwhile;
 * dropping them would cut the opening of every recording (measured: 30 frames
 * lost at 1080p60, none after). So the opening seconds get a generous allowance,
 * and once running the allowance is three quarters of a second of frames, which
 * is 30 frames at 30 fps and 45 at 60 fps.
 */
export function queueLimit(fps: number, sinceStartMs: number): number {
  const seconds = sinceStartMs < WARMUP_MS ? 2 : 0.75
  return Math.max(MAX_ENCODE_QUEUE, Math.round(fps * seconds))
}

// ── The browser pieces, as the session uses them ──

export interface EncodedChunk { type: 'key' | 'delta' }

export interface VideoEncoderLike {
  readonly encodeQueueSize: number
  configure(config: unknown): void
  encode(frame: unknown, options?: { keyFrame: boolean }): void
  flush(): Promise<void>
  close(): void
}
export interface AudioEncoderLike {
  readonly encodeQueueSize: number
  configure(config: unknown): void
  encode(data: unknown): void
  flush(): Promise<void>
  close(): void
}
export interface MuxerLike {
  addVideoChunk(chunk: unknown, meta?: unknown): void
  addAudioChunk(chunk: unknown, meta?: unknown): void
  finalize(): void
}

export interface VideoEncoderInit {
  output: (chunk: EncodedChunk, meta?: unknown) => void
  error: (e: unknown) => void
}

export interface MuxerOptions {
  width: number
  height: number
  fps: number
  audio: boolean
  /** False for a file of sound alone, which carries one of the extra audio tracks. */
  video: boolean
  onData: (data: Uint8Array, position: number) => void
}

export interface SessionDeps {
  createVideoEncoder(init: VideoEncoderInit): VideoEncoderLike
  createAudioEncoder(init: VideoEncoderInit): AudioEncoderLike
  /** Resolves true if the browser can encode with this configuration. */
  videoSupported(config: Record<string, unknown>): Promise<boolean>
  createMuxer(options: MuxerOptions): MuxerLike
  createVideoFrame(source: unknown, timestampUs: number): { close(): void }
  createAudioData(init: { timestampUs: number; frames: number; data: Float32Array }): { close(): void }
}

export interface SessionStats {
  framesIn: number
  framesDropped: number
  videoChunks: number
  audioChunks: number
  keyframes: number
  encodeQueue: number
  audioBlocks: number
  /** Bytes of finished output produced so far. */
  bytesOut: number
  silenceFrames: number
  trimmedFrames: number
  hardware: boolean
}

/** H.264 High profile; level 4.0 covers 1080p30, 4.2 covers 1080p60, 5.1 anything larger. */
export function h264Codec(width: number, height: number, fps: number): string {
  const macroblocksPerSecond = Math.ceil(width / 16) * Math.ceil(height / 16) * fps
  if (macroblocksPerSecond <= 245_760) return 'avc1.640028' // 4.0
  if (macroblocksPerSecond <= 522_240) return 'avc1.64002A' // 4.2
  return 'avc1.640033' // 5.1
}

export class EncoderSession {
  private readonly counters = {
    framesIn: 0, framesDropped: 0, videoChunks: 0, audioChunks: 0, keyframes: 0,
    audioBlocks: 0, silenceFrames: 0, trimmedFrames: 0, bytesOut: 0,
  }
  private readonly errors: string[] = []
  private readonly keyEvery: number
  private readonly timeline = new AudioTimeline({ sampleRate: SAMPLE_RATE })

  private videoEncoder!: VideoEncoderLike
  private audioEncoder: AudioEncoderLike | null = null
  private muxer!: MuxerLike
  /**
   * The audio tracks after the first. Each is a file of sound alone, so that the
   * muxer, which holds one audio track, can still produce several; FFmpeg joins
   * them. Every one starts at time zero so that they line up with the picture.
   */
  private readonly extras: Array<{ encoder: AudioEncoderLike; muxer: MuxerLike; started: boolean }> = []
  private hardware = false

  private startedAtMs = 0
  private running = false
  private frameNumber = 0
  private finished = false

  /** Called when an encoder fails after the session has started. */
  onError: (message: string) => void = () => {}

  private constructor(
    private readonly params: SessionParams,
    /** `track` is 0 for the output itself and 1, 2 for the extra audio tracks. */
    private readonly emit: (data: ArrayBuffer, track: number) => void,
    private readonly deps: SessionDeps,
  ) {
    this.keyEvery = Math.max(1, Math.round(params.fps * params.keyframeSeconds))
  }

  static async create(
    params: SessionParams,
    emit: (data: ArrayBuffer, track: number) => void,
    deps: SessionDeps,
  ): Promise<EncoderSession> {
    const session = new EncoderSession(params, emit, deps)
    await session.setUp()
    return session
  }

  private async setUp(): Promise<void> {
    const { params, deps } = this
    const base = {
      codec: h264Codec(params.width, params.height, params.fps),
      width: params.width,
      height: params.height,
      bitrate: params.videoBitrate,
      framerate: params.fps,
      latencyMode: 'realtime',
      avc: { format: 'avc' },
    }

    // Hardware first unless told otherwise; software is the fallback, not a failure.
    const order: Array<'prefer-hardware' | 'prefer-software'> =
      params.encoder === 'software' ? ['prefer-software']
        : params.encoder === 'hardware' ? ['prefer-hardware']
          : ['prefer-hardware', 'prefer-software']

    let chosen: Record<string, unknown> | null = null
    for (const hardwareAcceleration of order) {
      const config = { ...base, hardwareAcceleration }
      if (await deps.videoSupported(config)) { chosen = config; break }
    }
    if (!chosen) {
      throw new Error(
        params.encoder === 'hardware'
          ? 'This computer has no hardware video encoder for that size and frame rate.'
          : `This computer cannot encode ${params.width}x${params.height} at ${params.fps} fps.`,
      )
    }
    this.hardware = chosen.hardwareAcceleration === 'prefer-hardware'

    this.muxer = deps.createMuxer({
      width: params.width,
      height: params.height,
      fps: params.fps,
      audio: params.audio,
      video: true,
      onData: (data) => {
        // Copy: the muxer reuses its buffers.
        this.counters.bytesOut += data.byteLength
        this.emit(data.slice().buffer, 0)
      },
    })

    this.videoEncoder = deps.createVideoEncoder({
      output: (chunk, meta) => {
        this.counters.videoChunks++
        if (chunk.type === 'key') this.counters.keyframes++
        this.muxer.addVideoChunk(chunk, meta)
      },
      error: (e) => this.fail(`video: ${describe(e)}`),
    })
    this.videoEncoder.configure(chosen)

    if (params.audio) {
      this.audioEncoder = deps.createAudioEncoder({
        output: (chunk, meta) => {
          this.counters.audioChunks++
          this.muxer.addAudioChunk(chunk, meta)
        },
        error: (e) => this.fail(`audio: ${describe(e)}`),
      })
      this.audioEncoder.configure({
        codec: 'opus', sampleRate: SAMPLE_RATE, numberOfChannels: CHANNELS, bitrate: params.audioBitrate,
      })

      for (let track = 1; track < Math.min(MAX_TRACKS, params.tracks ?? 1); track++) this.addExtraTrack(track)
    }
  }

  private addExtraTrack(track: number): void {
    const { params, deps } = this
    const muxer = deps.createMuxer({
      width: params.width, height: params.height, fps: params.fps, audio: true, video: false,
      onData: (data) => this.emit(data.slice().buffer, track),
    })
    const encoder = deps.createAudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error: (e) => this.fail(`audio track ${track + 1}: ${describe(e)}`),
    })
    encoder.configure({ codec: 'opus', sampleRate: SAMPLE_RATE, numberOfChannels: CHANNELS, bitrate: params.audioBitrate })
    this.extras.push({ encoder, muxer, started: false })
  }

  /** Starts the clock. Frames and audio before this are ignored. */
  start(nowMs: number): void {
    this.startedAtMs = nowMs
    this.running = true
  }

  /** Called by the draw loop right after a frame is composed. */
  submitFrame(canvas: unknown, nowMs: number): void {
    if (!this.running || this.finished) return

    this.counters.framesIn++

    // Falling behind: drop a frame rather than let latency grow without limit.
    if (this.videoEncoder.encodeQueueSize > queueLimit(this.params.fps, nowMs - this.startedAtMs)) {
      this.counters.framesDropped++
      return
    }

    const timestampUs = Math.max(0, Math.round((nowMs - this.startedAtMs) * 1000))
    const frame = this.deps.createVideoFrame(canvas, timestampUs)
    try {
      this.videoEncoder.encode(frame, { keyFrame: this.frameNumber % this.keyEvery === 0 })
    } finally {
      // The encoder takes its own reference; leaving this open leaks.
      frame.close()
    }
    this.frameNumber++
  }

  /**
   * Takes a block of mixed audio: planar float32, left then right, that by the
   * wall clock began at `wallStartMs`.
   */
  submitAudio(wallStartMs: number, frames: number, planar: Float32Array, extraTracks: readonly Float32Array[] = []): void {
    if (!this.running || this.finished || !this.audioEncoder) return

    const relativeMs = wallStartMs - this.startedAtMs
    // Before the recording began.
    if (relativeMs + (frames / SAMPLE_RATE) * 1000 <= 0) return

    const placement = this.timeline.place(Math.max(0, relativeMs), frames)
    this.counters.audioBlocks++

    if (placement.padFrames > 0) {
      this.counters.silenceFrames += placement.padFrames
      // The gap is filled in pieces so no single buffer is huge after a long stall.
      const piece = SAMPLE_RATE // one second
      let remaining = placement.padFrames
      let at = placement.timestampUs - Math.round((placement.padFrames / SAMPLE_RATE) * 1_000_000)
      while (remaining > 0) {
        const n = Math.min(piece, remaining)
        this.encodeAudio(at, n, new Float32Array(n * CHANNELS))
        for (let i = 0; i < this.extras.length; i++) this.encodeExtra(i, at, n, new Float32Array(n * CHANNELS))
        at += Math.round((n / SAMPLE_RATE) * 1_000_000)
        remaining -= n
      }
    }

    const keep = frames - placement.skipFrames
    if (keep <= 0) return
    this.counters.trimmedFrames += placement.skipFrames

    const cut = (block: Float32Array) => (placement.skipFrames === 0 ? block : trim(block, frames, placement.skipFrames))
    this.encodeAudio(placement.timestampUs, keep, cut(planar))
    for (let i = 0; i < this.extras.length; i++) {
      this.encodeExtra(i, placement.timestampUs, keep, cut(extraTracks[i] ?? new Float32Array(frames * CHANNELS)))
    }
  }

  /** Sound for one of the extra tracks, which has to begin at zero so that it lines up with the picture. */
  private encodeExtra(index: number, timestampUs: number, frames: number, data: Float32Array): void {
    const extra = this.extras[index]
    if (!extra.started) {
      extra.started = true
      // Silence from the start up to where the first sound lies, a second at a time.
      let at = 0
      while (at < timestampUs) {
        const n = Math.min(SAMPLE_RATE, Math.round(((timestampUs - at) * SAMPLE_RATE) / 1_000_000))
        if (n <= 0) break
        this.encodeAudioOn(extra.encoder, at, n, new Float32Array(n * CHANNELS))
        at += Math.round((n / SAMPLE_RATE) * 1_000_000)
      }
    }
    this.encodeAudioOn(extra.encoder, timestampUs, frames, data)
  }

  private encodeAudio(timestampUs: number, frames: number, data: Float32Array): void {
    if (this.audioEncoder) this.encodeAudioOn(this.audioEncoder, timestampUs, frames, data)
  }

  private encodeAudioOn(encoder: AudioEncoderLike, timestampUs: number, frames: number, data: Float32Array): void {
    const audio = this.deps.createAudioData({ timestampUs, frames, data })
    try {
      encoder.encode(audio)
    } finally {
      // The encoder takes its own reference. Leaving this open leaks about
      // 0.4 MB/s and, after roughly seven and a half minutes, the audio stops
      // altogether while video carries on.
      audio.close()
    }
  }

  stats(): SessionStats {
    return {
      ...this.counters,
      encodeQueue: this.videoEncoder?.encodeQueueSize ?? 0,
      hardware: this.hardware,
    }
  }

  get failure(): string | null {
    return this.errors[0] ?? null
  }

  /** Finishes the file: waits for everything queued to be encoded, then closes the container. */
  async stop(): Promise<void> {
    if (this.finished) return
    this.running = false
    this.finished = true

    try {
      await this.videoEncoder.flush()
      if (this.audioEncoder) await this.audioEncoder.flush()
      for (const extra of this.extras) await extra.encoder.flush()
      this.muxer.finalize()
      for (const extra of this.extras) extra.muxer.finalize()
    } finally {
      closeQuietly(this.videoEncoder)
      closeQuietly(this.audioEncoder)
      for (const extra of this.extras) closeQuietly(extra.encoder)
    }
  }

  /** Abandons the session without finishing the file. */
  abort(): void {
    this.running = false
    this.finished = true
    closeQuietly(this.videoEncoder)
    closeQuietly(this.audioEncoder)
    for (const extra of this.extras) closeQuietly(extra.encoder)
  }

  private fail(message: string): void {
    this.errors.push(message)
    if (this.finished) return
    this.running = false
    this.onError(message)
  }
}

/** Drops the first `skip` frames of each channel of a planar block. */
function trim(planar: Float32Array, frames: number, skip: number): Float32Array {
  const keep = frames - skip
  const out = new Float32Array(keep * CHANNELS)
  for (let c = 0; c < CHANNELS; c++) {
    out.set(planar.subarray(c * frames + skip, (c + 1) * frames), c * keep)
  }
  return out
}

function closeQuietly(encoder: { close(): void } | null | undefined): void {
  try { encoder?.close() } catch { /* already closed */ }
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
