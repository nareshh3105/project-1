import type { PageUpdate } from '../../../shared/host'
import { PageMirror } from './mirror'

/**
 * Browser sources: a web page drawn into the scene.
 *
 * Each runs in a hidden window that paints off-screen, and its pictures are sent
 * to whichever windows are showing it: the interface for the preview, the output
 * host for the recording. One page is kept per source however many windows show
 * it, and it is closed when the last window stops.
 *
 * The page is untrusted content. The view that runs it is set up with no access
 * to the app (see view.ts); what is decided here is which addresses may be loaded
 * and how large and fast a page may be.
 */

export interface BrowserSpec {
  url: string
  width: number
  height: number
  fps: number
}

export const LIMITS = {
  side: { min: 16, max: 4096 },
  fps: { min: 1, max: 60 },
  /** More pages than this would exhaust memory long before they were useful. */
  pages: 8,
  urlLength: 2048,
} as const

export const DEFAULT_SPEC = { width: 1280, height: 720, fps: 30 }

const clamp = (v: unknown, fallback: number, lo: number, hi: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback

/**
 * Checks a request for a page. Only web addresses may be loaded: a file path or
 * another scheme could read things off the computer or run something.
 */
export function normalizeSpec(raw: Record<string, unknown>): BrowserSpec {
  const text = typeof raw.url === 'string' ? raw.url.trim() : ''
  if (!text) throw new Error('Enter the address of a web page.')
  if (text.length > LIMITS.urlLength) throw new Error('That address is too long.')

  // People type "example.com"; read it as a web address rather than refusing.
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    throw new Error('That is not a valid web address.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only web addresses starting with http:// or https:// can be used.')
  }
  if (!url.hostname) throw new Error('That is not a valid web address.')

  return {
    url: url.toString(),
    width: clamp(raw.width, DEFAULT_SPEC.width, LIMITS.side.min, LIMITS.side.max),
    height: clamp(raw.height, DEFAULT_SPEC.height, LIMITS.side.min, LIMITS.side.max),
    fps: clamp(raw.fps, DEFAULT_SPEC.fps, LIMITS.fps.min, LIMITS.fps.max),
  }
}

const sameSpec = (a: BrowserSpec, b: BrowserSpec) =>
  a.url === b.url && a.width === b.width && a.height === b.height && a.fps === b.fps

/** One hidden page. */
export interface PageView {
  /** Called with each region of the page that has changed. */
  onFrame(cb: (update: PageUpdate) => void): void
  /** Called when the page cannot be loaded. */
  onFailure(cb: (message: string) => void): void
  reload(): void
  destroy(): void
}

export interface BrowserDeps {
  createView(spec: BrowserSpec): PageView
  /** Sends a changed region to a window. */
  sendFrame(windowId: number, id: string, update: PageUpdate): void
  /** Tells a window a page failed. */
  sendFailure(windowId: number, id: string, message: string): void
}

interface Page {
  spec: BrowserSpec
  view: PageView
  /** Windows showing this page. */
  watchers: Set<number>
  /** The whole picture, so a window that starts watching has all of it at once. */
  mirror: PageMirror
  failure: string | null
}

export class BrowserSources {
  private readonly pages = new Map<string, Page>()

  constructor(private readonly deps: BrowserDeps) {}

  get count(): number {
    return this.pages.size
  }

  /**
   * A window starts showing a page. Asking again with a different address or
   * size starts the page afresh for everyone showing it.
   */
  attach(windowId: number, id: unknown, raw: Record<string, unknown>): BrowserSpec {
    if (typeof id !== 'string' || id.length === 0 || id.length > 128) throw new Error('Missing source.')
    const spec = normalizeSpec(raw)

    const existing = this.pages.get(id)
    if (existing && sameSpec(existing.spec, spec)) {
      existing.watchers.add(windowId)
      const whole = existing.mirror.whole()
      if (whole) this.deps.sendFrame(windowId, id, whole)
      if (existing.failure) this.deps.sendFailure(windowId, id, existing.failure)
      return spec
    }

    if (!existing && this.pages.size >= LIMITS.pages) {
      throw new Error(`No more than ${LIMITS.pages} browser sources can run at once.`)
    }

    // A changed page replaces the old one, and everyone who was watching carries on watching.
    const watchers = new Set(existing?.watchers ?? [])
    watchers.add(windowId)
    existing?.view.destroy()

    const page: Page = { spec, view: this.deps.createView(spec), watchers, mirror: new PageMirror(), failure: null }
    this.pages.set(id, page)

    page.view.onFrame((update) => {
      if (this.pages.get(id) !== page) return
      if (!page.mirror.apply(update)) return // not a usable region; nothing to show or send
      page.failure = null
      for (const w of page.watchers) this.deps.sendFrame(w, id, update)
    })
    page.view.onFailure((message) => {
      if (this.pages.get(id) !== page) return
      page.failure = message
      for (const w of page.watchers) this.deps.sendFailure(w, id, message)
    })
    return spec
  }

  /** A window stops showing a page; the page closes with its last watcher. */
  detach(windowId: number, id: unknown): void {
    if (typeof id !== 'string') return
    const page = this.pages.get(id)
    if (!page) return

    page.watchers.delete(windowId)
    if (page.watchers.size === 0) {
      page.view.destroy()
      this.pages.delete(id)
    }
  }

  /** A window has closed: it stops showing everything. */
  detachAll(windowId: number): void {
    for (const id of [...this.pages.keys()]) this.detach(windowId, id)
  }

  reload(id: unknown): void {
    if (typeof id === 'string') this.pages.get(id)?.view.reload()
  }

  shutdown(): void {
    for (const page of this.pages.values()) page.view.destroy()
    this.pages.clear()
  }
}
