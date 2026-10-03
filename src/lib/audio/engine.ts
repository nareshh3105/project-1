import {
  SILENT, decayPeak, measure, type ChannelLevels,
} from './levels'
import { ipc } from '@/ipc'
import { exclusively } from '@/lib/capture/gate'

/**
 * Real per-channel audio metering.
 *
 * Replaces the synthesised levels the backend used to emit. Metering lives in
 * the renderer because that is where Web Audio and the capture streams already
 * are; the main process never sees the audio.
 *
 * A channel with no source reads silent. That is deliberate — a meter that
 * moves without input is worse than one that sits still, because it tells the
 * user their microphone is working when it may not be.
 */

const FFT_SIZE = 2048

/**
 * getFloatTimeDomainData requires a view over a plain ArrayBuffer, not the
 * ArrayBufferLike a bare `new Float32Array(n)` is typed as.
 */
type SampleBuffer = Float32Array<ArrayBuffer>
const sampleBuffer = (): SampleBuffer =>
  new Float32Array(new ArrayBuffer(FFT_SIZE * Float32Array.BYTES_PER_ELEMENT))
const PEAK_DECAY_DB_PER_SEC = 20

export type ChannelId = 'desktop' | 'mic' | 'browser' | 'music'

interface ChannelNodes {
  stream: MediaStream
  source: MediaStreamAudioSourceNode
  splitter: ChannelSplitterNode
  /** One analyser per side; mono sources feed both from the same channel. */
  analysers: [AnalyserNode, AnalyserNode]
  buffers: [SampleBuffer, SampleBuffer]
  holdL: number
  holdR: number
}

export interface EngineOptions {
  /** Current fader position for a channel, 0–1. */
  gainOf: (id: ChannelId) => number
  /** Whether a channel is muted. */
  mutedOf: (id: ChannelId) => boolean
  /** Called on every frame with the measured levels. */
  onLevels: (levels: Record<ChannelId, ChannelLevels>) => void
}

export class AudioEngine {
  private context: AudioContext | null = null
  private channels = new Map<ChannelId, ChannelNodes>()
  private frame: number | null = null
  private lastFrameAt = 0

  constructor(private readonly options: EngineOptions) {}

  /** True once at least one real source is attached. */
  get hasSources(): boolean {
    return this.channels.size > 0
  }

  attachedChannels(): ChannelId[] {
    return [...this.channels.keys()]
  }

  private ensureContext(): AudioContext {
    if (!this.context) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.context = new Ctor()
    }
    return this.context
  }

  /**
   * Routes a stream into a channel. Replaces whatever was there, so switching
   * microphone does not leave the previous device metering.
   */
  attach(id: ChannelId, stream: MediaStream) {
    if (stream.getAudioTracks().length === 0) {
      throw new Error('Stream carries no audio track')
    }

    this.detach(id)

    const ctx = this.ensureContext()
    const source = ctx.createMediaStreamSource(stream)
    const splitter = ctx.createChannelSplitter(2)
    source.connect(splitter)

    const analysers: [AnalyserNode, AnalyserNode] = [
      ctx.createAnalyser(), ctx.createAnalyser(),
    ]

    analysers.forEach((analyser, i) => {
      analyser.fftSize = FFT_SIZE
      // A mono source exposes one output; feeding both analysers from channel
      // 0 shows it as centred rather than hard left.
      const outputChannel = Math.min(i, splitter.numberOfOutputs - 1)
      splitter.connect(analyser, outputChannel)
    })

    this.channels.set(id, {
      stream,
      source,
      splitter,
      analysers,
      buffers: [sampleBuffer(), sampleBuffer()],
      holdL: SILENT.peakL,
      holdR: SILENT.peakR,
    })

    // Tracks ending (device unplugged, user stops sharing) must clear the
    // channel, or it would freeze at its last reading.
    for (const track of stream.getAudioTracks()) {
      track.addEventListener('ended', () => this.detach(id))
    }
  }

  detach(id: ChannelId) {
    const channel = this.channels.get(id)
    if (!channel) return

    try {
      channel.source.disconnect()
      channel.splitter.disconnect()
      channel.analysers.forEach((a) => a.disconnect())
    } catch {
      // Already torn down by the context closing.
    }
    this.channels.delete(id)
  }

  start() {
    if (this.frame !== null) return
    this.lastFrameAt = performance.now()

    const tick = () => {
      this.measureAll()
      this.frame = requestAnimationFrame(tick)
    }
    this.frame = requestAnimationFrame(tick)
  }

  stop() {
    if (this.frame !== null) cancelAnimationFrame(this.frame)
    this.frame = null
  }

  /** Releases every node and the context itself. */
  async dispose() {
    this.stop()
    for (const id of [...this.channels.keys()]) this.detach(id)
    if (this.context) {
      await this.context.close().catch(() => {})
      this.context = null
    }
  }

  private measureAll() {
    const now = performance.now()
    const elapsed = now - this.lastFrameAt
    this.lastFrameAt = now

    const levels = {
      desktop: SILENT, mic: SILENT, browser: SILENT, music: SILENT,
    } as Record<ChannelId, ChannelLevels>

    for (const [id, channel] of this.channels) {
      const gain = this.options.mutedOf(id) ? 0 : this.options.gainOf(id)

      channel.analysers[0].getFloatTimeDomainData(channel.buffers[0])
      channel.analysers[1].getFloatTimeDomainData(channel.buffers[1])

      const left = measure(channel.buffers[0], gain)
      const right = measure(channel.buffers[1], gain)

      channel.holdL = decayPeak(channel.holdL, left.peak, PEAK_DECAY_DB_PER_SEC, elapsed)
      channel.holdR = decayPeak(channel.holdR, right.peak, PEAK_DECAY_DB_PER_SEC, elapsed)

      levels[id] = {
        peakL: channel.holdL,
        peakR: channel.holdR,
        rmsL: left.rms,
        rmsR: right.rms,
      }
    }

    this.options.onLevels(levels)
  }
}

/**
 * Requests the microphone. Rejects with a message worth showing rather than a
 * bare DOMException name.
 */
export async function requestMicrophone(deviceId?: string): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      video: false,
    })
  } catch (err) {
    throw new Error(describeMediaError(err, 'microphone'))
  }
}

/**
 * Requests system audio: everything the machine is playing, captured as
 * loopback.
 *
 * Audio cannot be requested on its own, so a screen is asked for as well and
 * its video is discarded. The request has to be declared to the main process
 * first; without that it is refused (and before this existed, getDisplayMedia
 * failed outright in the packaged app).
 */
export async function requestDesktopAudio(): Promise<MediaStream> {
  let stream: MediaStream
  try {
    const screens = await ipc.capture.listSources(['screen'])
    if (screens.length === 0) throw new Error('No screen was found to attach system audio to.')

    stream = await exclusively(async () => {
      await ipc.capture.prepare(screens[0].id, true)
      return navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
    })
  } catch (err) {
    throw new Error(describeMediaError(err, 'system audio'))
  }

  if (stream.getAudioTracks().length === 0) {
    stream.getTracks().forEach((t) => t.stop())
    throw new Error('Windows did not provide system audio.')
  }

  // The video track is only there because audio cannot be requested alone.
  stream.getVideoTracks().forEach((t) => {
    t.stop()
    stream.removeTrack(t)
  })

  return stream
}

function describeMediaError(err: unknown, what: string): string {
  const name = err instanceof Error ? err.name : ''
  switch (name) {
    case 'NotAllowedError':
      return `Permission to use the ${what} was denied.`
    case 'NotFoundError':
      return `No ${what} device was found.`
    case 'NotReadableError':
      return `The ${what} is in use by another application.`
    default:
      return err instanceof Error && err.message
        ? err.message
        : `Could not open the ${what}.`
  }
}
