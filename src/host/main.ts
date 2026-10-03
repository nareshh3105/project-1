import { Muxer, StreamTarget } from 'mp4-muxer'
import { HostApp, type Bridge } from './hostApp'
import type { PoolVideo } from './capturePool'
import { createAudioRig } from './audioRig'
import { SAMPLE_RATE, type SessionDeps } from './session'
import { openCaptureStream } from '@/lib/capture/open'

/**
 * Entry point of the output host window. Binds the host to the browser's real
 * encoders, muxer, capture and audio, and starts it.
 */

const bridge = (window as unknown as { codebuilders?: Bridge }).codebuilders
if (!bridge) throw new Error('Backend bridge unavailable — the preload script did not load.')

const session: SessionDeps = {
  createVideoEncoder: (init) => new VideoEncoder(init as VideoEncoderInit),
  createAudioEncoder: (init) => new AudioEncoder(init as AudioEncoderInit),
  videoSupported: async (config) => (await VideoEncoder.isConfigSupported(config as unknown as VideoEncoderConfig)).supported === true,
  createVideoFrame: (source, timestampUs) => new VideoFrame(source as CanvasImageSource, { timestamp: timestampUs }),
  createAudioData: ({ timestampUs, frames, data }) =>
    new AudioData({
      format: 'f32-planar',
      sampleRate: SAMPLE_RATE,
      numberOfFrames: frames,
      numberOfChannels: 2,
      timestamp: timestampUs,
      data: data as Float32Array<ArrayBuffer>,
    }),
  createMuxer: ({ width, height, fps, audio, onData }) => {
    const muxer = new Muxer({
      target: new StreamTarget({ chunked: false, onData: (data, position) => onData(data, position) }),
      video: { codec: 'avc', width, height, frameRate: fps },
      ...(audio ? { audio: { codec: 'opus' as const, numberOfChannels: 2, sampleRate: SAMPLE_RATE } } : {}),
      fastStart: 'fragmented',
      // Both tracks are already on one clock; keep their relative offset.
      firstTimestampBehavior: 'cross-track-offset',
    })
    return muxer as never
  },
}

const app = new HostApp({
  bridge,
  session,
  pool: {
    open: openCaptureStream,
    createVideo: () => {
      const video = document.createElement('video')
      video.muted = true
      video.playsInline = true
      return video as unknown as PoolVideo
    },
  },
  loop: {
    now: () => performance.now(),
    setTimer: (cb, ms) => setTimeout(cb, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  },
  now: () => performance.now(),
  createCanvas: (width, height) => {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { alpha: false, desynchronized: true })
    if (!context) throw new Error('Could not create a drawing surface for the output.')
    return { canvas, context }
  },
  createAudio: createAudioRig,
})

app.start()
;(window as unknown as { __host: HostApp }).__host = app
window.addEventListener('beforeunload', () => app.dispose())
