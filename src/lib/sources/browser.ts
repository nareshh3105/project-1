import type { SourceType } from '@/types'

/**
 * The browser source: a web page drawn into the scene, with a transparent
 * background, for overlays, alerts, clocks and the like.
 *
 * Settings are read defensively, as they come from the database. Whether an
 * address may be loaded is decided by the main process, which has the final say.
 */

export const isBrowserType = (type: SourceType | string): boolean => type === 'browser_source'

export interface BrowserSettings {
  url: string
  /** Size of the page itself, in pixels; independent of the size of the source in the scene. */
  width: number
  height: number
  fps: number
}

export const DEFAULT_BROWSER: BrowserSettings = { url: '', width: 1280, height: 720, fps: 30 }

export const DEFAULT_BROWSER_PLACEMENT = { x: 0, y: 0, width: 1280, height: 720 }

const LIMITS = { side: [16, 4096], fps: [1, 60] } as const

const within = (v: unknown, fallback: number, [lo, hi]: readonly [number, number]) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback

export function parseBrowser(settings: Record<string, unknown> | undefined): BrowserSettings {
  const s = settings ?? {}
  return {
    url: typeof s.url === 'string' ? s.url.trim().slice(0, 2048) : '',
    width: within(s.width, DEFAULT_BROWSER.width, LIMITS.side),
    height: within(s.height, DEFAULT_BROWSER.height, LIMITS.side),
    fps: within(s.fps, DEFAULT_BROWSER.fps, LIMITS.fps),
  }
}

/** A string that is the same exactly when the page would have to be started afresh. */
export const pageKey = (b: BrowserSettings): string => `${b.url}|${b.width}x${b.height}@${b.fps}`

/**
 * A quick check of what was typed, to say what is wrong before anything is tried.
 * The main process makes the real decision; this only mirrors it so the message
 * can appear as the address is typed. Returns null when the address is usable.
 */
export function checkAddress(text: string): string | null {
  const t = text.trim()
  if (!t) return null // nothing typed yet is not a mistake
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`
  let url: URL
  try { url = new URL(candidate) } catch { return 'That is not a valid web address.' }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'Only web addresses starting with http:// or https:// can be used.'
  return url.hostname ? null : 'That is not a valid web address.'
}
