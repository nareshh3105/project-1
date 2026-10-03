import type { SnapshotSource } from '../../shared/host'
import type { CaptureTarget } from '@/lib/capture/target'
import { targetKindFor } from '@/lib/capture/target'
import type { SourceType } from '@/types'

/**
 * The captures the output host keeps open: one live stream, and the video
 * element that plays it, per capture source in the scene.
 *
 * The scene state arrives on every change, including every pixel of a drag, so
 * `sync` must be cheap and must never restart a capture that has not changed.
 */

/** The part of a video element the pool uses. */
export interface PoolVideo {
  srcObject: MediaStream | null
  muted: boolean
  readonly readyState: number
  readonly videoWidth: number
  readonly videoHeight: number
  play(): Promise<void>
}

export interface PoolDeps {
  open: (target: CaptureTarget) => Promise<MediaStream>
  createVideo: () => PoolVideo
}

type State = 'starting' | 'live' | 'failed'

interface Entry {
  key: string
  target: CaptureTarget
  video: PoolVideo
  stream: MediaStream | null
  state: State
  error: string | null
}

/** HAVE_CURRENT_DATA: a frame has been decoded and can be drawn. */
const HAVE_CURRENT_DATA = 2

const keyOf = (t: CaptureTarget) => `${t.kind}|${t.id}|${t.name}`

export class CapturePool {
  private readonly entries = new Map<string, Entry>()

  constructor(
    private readonly deps: PoolDeps,
    /** Called when a capture goes live or fails. */
    private readonly onChange: () => void = () => {},
  ) {}

  /** Brings the open captures in line with the scene. */
  sync(sources: readonly SnapshotSource[]): void {
    const wanted = new Map<string, CaptureTarget>()
    for (const s of sources) {
      if (!s.target || !targetKindFor(s.type as SourceType)) continue
      wanted.set(s.id, s.target)
    }

    for (const [id, entry] of this.entries) {
      const target = wanted.get(id)
      if (!target || keyOf(target) !== entry.key) this.release(id)
    }
    for (const [id, target] of wanted) {
      if (!this.entries.has(id)) this.start(id, target)
    }
  }

  /** The picture to draw for a source, or null if it has none yet. */
  frameFor(id: string): { image: PoolVideo; width: number; height: number } | null {
    const entry = this.entries.get(id)
    if (!entry || entry.state !== 'live') return null

    const { video } = entry
    if (video.readyState < HAVE_CURRENT_DATA || !(video.videoWidth > 0) || !(video.videoHeight > 0)) return null
    return { image: video, width: video.videoWidth, height: video.videoHeight }
  }

  /** Why each failed capture failed. */
  errors(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const [id, e] of this.entries) if (e.state === 'failed' && e.error) out[id] = e.error
    return out
  }

  /** Tries again the captures that failed, for instance a window that was not open before. */
  retryFailed(): void {
    for (const [id, entry] of [...this.entries]) {
      if (entry.state !== 'failed') continue
      const target = entry.target
      this.release(id)
      this.start(id, target)
    }
  }

  stopAll(): void {
    for (const id of [...this.entries.keys()]) this.release(id)
  }

  get size(): number {
    return this.entries.size
  }

  // ── internals ──

  private start(id: string, target: CaptureTarget): void {
    const entry: Entry = {
      key: keyOf(target), target, video: this.deps.createVideo(),
      stream: null, state: 'starting', error: null,
    }
    this.entries.set(id, entry)

    void this.open(id, entry)
  }

  private async open(id: string, entry: Entry): Promise<void> {
    try {
      const stream = await this.deps.open(entry.target)

      // The source was removed, or retargeted, while the stream was opening.
      if (this.entries.get(id) !== entry) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }

      entry.stream = stream
      entry.video.muted = true
      entry.video.srcObject = stream
      await entry.video.play().catch(() => { /* a muted video that cannot autoplay is still drawable once it has data */ })

      // Closing the window being captured, or the user ending the share.
      stream.getVideoTracks().forEach((track) => {
        track.addEventListener('ended', () => {
          if (this.entries.get(id) !== entry) return
          entry.state = 'failed'
          entry.error = 'The source was closed.'
          this.onChange()
        })
      })

      if (this.entries.get(id) === entry) {
        entry.state = 'live'
        this.onChange()
      }
    } catch (err) {
      if (this.entries.get(id) !== entry) return
      entry.state = 'failed'
      entry.error = err instanceof Error && err.message ? err.message : 'Capture failed.'
      this.onChange()
    }
  }

  private release(id: string): void {
    const entry = this.entries.get(id)
    if (!entry) return

    this.entries.delete(id)
    entry.stream?.getTracks().forEach((t) => t.stop())
    entry.video.srcObject = null
  }
}
