import type { SnapshotSource } from '../../shared/host'
import { isMediaType, mediaGain, parseMedia, playbackProblem } from '@/lib/sources/media'

/**
 * The video and sound files being played for the scene.
 *
 * One `<video>` per media source, started when an output is running and the
 * source is in the scene, and dropped when it is not. The picture goes to the
 * compositor like any other; the sound is captured from the element and handed
 * to the mixer, so the element itself is kept silent and nothing comes out of
 * the speakers.
 */

/** The part of a video element this uses. */
export interface MediaVideo {
  src: string
  loop: boolean
  muted: boolean
  crossOrigin: string | null
  readonly readyState: number
  readonly videoWidth: number
  readonly videoHeight: number
  readonly error: { code: number } | null
  play(): Promise<void>
  pause(): void
  removeAttribute(name: string): void
  load(): void
  captureStream(): MediaStream
  addEventListener(type: 'error', listener: () => void): void
}

export interface MediaDeps {
  /** The address a chosen file can be played from, or rejects with a message worth showing. */
  resolveUrl(filePath: string): Promise<string>
  createVideo(): MediaVideo
}

export interface MediaAudio {
  id: string
  stream: MediaStream
  /** Level in the mix, 0 to 1. */
  gain: number
}

type State = 'starting' | 'playing' | 'failed'

interface Entry {
  key: string
  filePath: string
  loop: boolean
  gain: number
  video: MediaVideo
  stream: MediaStream | null
  state: State
  error: string | null
}

/** HAVE_CURRENT_DATA: a frame has been decoded and can be drawn. */
const HAVE_CURRENT_DATA = 2

export class MediaLayers {
  private readonly entries = new Map<string, Entry>()

  constructor(
    private readonly deps: MediaDeps,
    /** Called when a file starts playing or fails. */
    private readonly onChange: () => void = () => {},
  ) {}

  /** Brings the files being played in line with the scene. */
  sync(sources: readonly SnapshotSource[]): void {
    const wanted = new Map<string, SnapshotSource>()
    for (const s of sources) if (isMediaType(s.type)) wanted.set(s.id, s)

    for (const [id, entry] of [...this.entries]) {
      const source = wanted.get(id)
      if (!source) { this.release(id); continue }

      const m = parseMedia(source.settings)
      // A different file starts afresh; a change of loop or volume applies to what is playing.
      if (m.filePath !== entry.filePath) { this.release(id); continue }
      entry.loop = m.loop
      entry.video.loop = m.loop
      entry.gain = mediaGain(m)
    }

    for (const [id, source] of wanted) {
      if (!this.entries.has(id)) this.start(id, parseMedia(source.settings))
    }
  }

  /** The picture to draw for a source, or null if there is none (yet, or it is sound only). */
  frameFor(id: string): { image: MediaVideo; width: number; height: number } | null {
    const entry = this.entries.get(id)
    if (!entry || entry.state !== 'playing') return null

    const { video } = entry
    if (video.readyState < HAVE_CURRENT_DATA || !(video.videoWidth > 0) || !(video.videoHeight > 0)) return null
    return { image: video, width: video.videoWidth, height: video.videoHeight }
  }

  /** The sound of every file that is playing, with the level it is mixed at. */
  audio(): MediaAudio[] {
    const out: MediaAudio[] = []
    for (const [id, e] of this.entries) if (e.state === 'playing' && e.stream) out.push({ id, stream: e.stream, gain: e.gain })
    return out
  }

  /** Why each file that failed could not be played. */
  errors(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const [id, e] of this.entries) if (e.state === 'failed' && e.error) out[id] = e.error
    return out
  }

  stopAll(): void {
    for (const id of [...this.entries.keys()]) this.release(id)
  }

  get size(): number {
    return this.entries.size
  }

  // ── internals ──

  private start(id: string, m: ReturnType<typeof parseMedia>): void {
    const video = this.deps.createVideo()
    const entry: Entry = {
      key: m.filePath, filePath: m.filePath, loop: m.loop, gain: mediaGain(m),
      video, stream: null, state: 'starting', error: null,
    }
    this.entries.set(id, entry)

    // No file chosen yet: nothing to play, and nothing wrong.
    if (!m.filePath) return

    void this.open(id, entry)
  }

  private async open(id: string, entry: Entry): Promise<void> {
    const { video } = entry
    try {
      const url = await this.deps.resolveUrl(entry.filePath)
      if (this.entries.get(id) !== entry) return // removed, or pointed at another file, meanwhile

      // The picture is read into a canvas, which needs the file to be served as cross-origin safe.
      video.crossOrigin = 'anonymous'
      video.loop = entry.loop
      // Silent: the sound is captured below, not played.
      video.muted = true
      video.addEventListener('error', () => {
        if (this.entries.get(id) !== entry) return
        entry.state = 'failed'
        entry.error = playbackProblem(video.error?.code)
        this.onChange()
      })
      video.src = url

      await video.play()
      if (this.entries.get(id) !== entry) return

      try { entry.stream = video.captureStream() } catch { entry.stream = null }
      entry.state = 'playing'
      this.onChange()
    } catch (err) {
      if (this.entries.get(id) !== entry) return
      entry.state = 'failed'
      entry.error = video.error ? playbackProblem(video.error.code) : messageOf(err)
      this.onChange()
    }
  }

  private release(id: string): void {
    const entry = this.entries.get(id)
    if (!entry) return
    this.entries.delete(id)

    try { entry.video.pause() } catch { /* already stopped */ }
    entry.stream?.getTracks().forEach((t) => t.stop())
    // Let go of the file so the player stops reading it.
    entry.video.removeAttribute('src')
    try { entry.video.load() } catch { /* nothing loaded */ }
  }
}

const messageOf = (err: unknown) => (err instanceof Error && err.message ? err.message : 'The file could not be played.')
