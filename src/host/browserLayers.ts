import type { PageUpdate, SnapshotSource } from '../../shared/host'
import { isBrowserType, pageKey, parseBrowser } from '@/lib/sources/browser'

/**
 * The web pages shown in the scene.
 *
 * The main process runs each page in a hidden window and sends the regions of
 * it that change. Each page is kept on a canvas of its own and brought up to
 * date as regions arrive; the compositor draws from that canvas. A page that is
 * not changing sends nothing and costs nothing, however often the scene is drawn.
 */

/** The picture of one page. */
export interface PageSurface {
  readonly canvas: CanvasImageSource
  readonly width: number
  readonly height: number
  draw(update: PageUpdate): void
}

export interface BrowserDeps {
  /** Starts the main process running a page. Rejects with a message worth showing. */
  attach(id: string, spec: { url: string; width: number; height: number; fps: number }): Promise<unknown>
  detach(id: string): Promise<unknown> | void
  /** Subscribes to changed regions. Returns the way to stop. */
  onFrame(cb: (id: string, update: PageUpdate) => void): () => void
  onFailure(cb: (id: string, message: string) => void): () => void
  createSurface(width: number, height: number): PageSurface
}

interface Entry {
  key: string
  surface: PageSurface | null
  error: string | null
}

export class BrowserLayers {
  private readonly entries = new Map<string, Entry>()
  private readonly stops: Array<() => void>

  constructor(
    private readonly deps: BrowserDeps,
    /** Called when a page fails or recovers. */
    private readonly onChange: () => void = () => {},
  ) {
    this.stops = [
      deps.onFrame((id, update) => {
        const entry = this.entries.get(id)
        if (!entry) return

        // A page of a new size starts a new picture; its first region is the whole of it.
        if (!entry.surface || entry.surface.width !== update.width || entry.surface.height !== update.height) {
          entry.surface = deps.createSurface(update.width, update.height)
        }
        entry.surface.draw(update)

        if (entry.error) { entry.error = null; this.onChange() }
      }),
      deps.onFailure((id, message) => {
        const entry = this.entries.get(id)
        if (!entry) return
        entry.error = message
        this.onChange()
      }),
    ]
  }

  /** Brings the running pages in line with the scene. */
  sync(sources: readonly SnapshotSource[]): void {
    const wanted = new Map<string, ReturnType<typeof parseBrowser>>()
    for (const s of sources) {
      if (!isBrowserType(s.type)) continue
      const b = parseBrowser(s.settings)
      if (b.url) wanted.set(s.id, b)
    }

    for (const [id, entry] of [...this.entries]) {
      const b = wanted.get(id)
      if (!b || pageKey(b) !== entry.key) this.release(id)
    }
    for (const [id, b] of wanted) if (!this.entries.has(id)) this.start(id, b)
  }

  /** The picture to draw for a page, or null if it has none yet. */
  frameFor(id: string): { image: CanvasImageSource; width: number; height: number } | null {
    const surface = this.entries.get(id)?.surface
    return surface ? { image: surface.canvas, width: surface.width, height: surface.height } : null
  }

  /** Why each page that failed could not be shown. */
  errors(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const [id, e] of this.entries) if (e.error) out[id] = e.error
    return out
  }

  stopAll(): void {
    for (const id of [...this.entries.keys()]) this.release(id)
  }

  /** Stops listening altogether. */
  dispose(): void {
    this.stopAll()
    this.stops.forEach((stop) => stop())
    this.stops.length = 0
  }

  get size(): number {
    return this.entries.size
  }

  // ── internals ──

  private start(id: string, b: ReturnType<typeof parseBrowser>): void {
    const entry: Entry = { key: pageKey(b), surface: null, error: null }
    this.entries.set(id, entry)

    this.deps.attach(id, { url: b.url, width: b.width, height: b.height, fps: b.fps }).catch((err) => {
      if (this.entries.get(id) !== entry) return
      entry.error = err instanceof Error && err.message ? err.message : String(err || 'The page could not be started.')
      this.onChange()
    })
  }

  private release(id: string): void {
    if (!this.entries.has(id)) return
    this.entries.delete(id)
    void this.deps.detach(id)
  }
}
