import type { SnapshotSource } from '../../shared/host'
import {
  isImagePath, isStaticType, lookKey, paintColor, paintText, parseColor, parseImage, parseText,
  type PaintContext, type StaticType,
} from '@/lib/sources/static'

/**
 * The pictures for sources that are drawn from their settings: a color, some
 * text, an image. Colors and text are painted onto a canvas the size of the
 * source's box and repainted only when their look changes; an image is loaded
 * once per file.
 *
 * Nothing is captured, so unlike the capture pool there is no stream to open
 * and nothing to release, only canvases to forget when a source goes away.
 */

export interface LoadedImage {
  image: CanvasImageSource
  width: number
  height: number
}

export interface StaticDeps {
  createCanvas(width: number, height: number): { canvas: CanvasImageSource; context: PaintContext }
  loadImage(filePath: string): Promise<LoadedImage>
}

export interface StaticFrame {
  image: CanvasImageSource
  width: number
  height: number
}

interface Painted {
  kind: 'painted'
  key: string
  image: CanvasImageSource
  width: number
  height: number
}

interface ImageEntry {
  kind: 'image'
  filePath: string
  state: 'loading' | 'ready' | 'failed'
  loaded: LoadedImage | null
  error: string | null
}

type Entry = Painted | ImageEntry

/** A box larger than this is a mistake, and a canvas that size would exhaust memory. */
const MAX_SIDE = 4096
const side = (n: number) => Math.min(MAX_SIDE, Math.max(1, Math.round(n)))

export class StaticLayers {
  private readonly entries = new Map<string, Entry>()

  constructor(
    private readonly deps: StaticDeps,
    /** Called when an image finishes loading or fails. */
    private readonly onChange: () => void = () => {},
  ) {}

  /** The picture to draw for a source, or null if it has none (yet). */
  frameFor(source: SnapshotSource): StaticFrame | null {
    if (!isStaticType(source.type)) return null
    const type: StaticType = source.type

    if (type === 'image') return this.imageFor(source)
    return this.paintedFor(source, type)
  }

  /** Forgets the sources that are no longer in the scene. */
  prune(sources: readonly SnapshotSource[]): void {
    const keep = new Set(sources.map((s) => s.id))
    for (const id of [...this.entries.keys()]) if (!keep.has(id)) this.entries.delete(id)
  }

  /** Why each image could not be shown. */
  errors(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const [id, e] of this.entries) if (e.kind === 'image' && e.state === 'failed' && e.error) out[id] = e.error
    return out
  }

  clear(): void {
    this.entries.clear()
  }

  // ── internals ──

  private paintedFor(source: SnapshotSource, type: Exclude<StaticType, 'image'>): StaticFrame {
    const width = side(source.transform.width)
    const height = side(source.transform.height)
    const key = lookKey(type, source.settings, width, height)

    const existing = this.entries.get(source.id)
    if (existing?.kind === 'painted' && existing.key === key) return existing

    const { canvas, context } = this.deps.createCanvas(width, height)
    if (type === 'color_source') paintColor(context, parseColor(source.settings), width, height)
    else paintText(context, parseText(source.settings), width, height)

    const painted: Painted = { kind: 'painted', key, image: canvas, width, height }
    this.entries.set(source.id, painted)
    return painted
  }

  private imageFor(source: SnapshotSource): StaticFrame | null {
    const { filePath } = parseImage(source.settings)
    const existing = this.entries.get(source.id)

    if (existing?.kind === 'image' && existing.filePath === filePath) {
      return existing.state === 'ready' && existing.loaded ? existing.loaded : null
    }

    const entry: ImageEntry = { kind: 'image', filePath, state: 'loading', loaded: null, error: null }
    this.entries.set(source.id, entry)

    if (!filePath) { entry.state = 'ready'; return null } // no file chosen yet: nothing to draw
    if (!isImagePath(filePath)) {
      entry.state = 'failed'
      entry.error = 'That file is not a picture.'
      return null
    }

    void this.deps.loadImage(filePath).then(
      (loaded) => {
        // The source was removed, or pointed at another file, while this loaded.
        if (this.entries.get(source.id) !== entry) return
        entry.loaded = loaded
        entry.state = 'ready'
        this.onChange()
      },
      (err) => {
        if (this.entries.get(source.id) !== entry) return
        entry.state = 'failed'
        entry.error = err instanceof Error && err.message ? err.message : 'The picture could not be loaded.'
        this.onChange()
      },
    )
    return null
  }
}
