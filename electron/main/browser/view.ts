import { BrowserWindow } from 'electron'
import type { PageUpdate } from '../../../shared/host'
import type { BrowserSpec, PageView } from './sources'

/**
 * Runs one browser source: a hidden window that paints a web page off-screen.
 *
 * The page is untrusted. The window has no access to the app: no Node, no
 * preload, the strictest sandbox, a session of its own that keeps nothing, and
 * it may not open windows, ask for the camera or microphone, download files or
 * go anywhere but a web address. Its sound is muted; only its picture is used.
 */

/** Whether the page may go to this address. */
export const isWebAddress = (url: string): boolean => /^https?:\/\//i.test(url)

/** A load failure in words for the user. Codes are Chromium's net error numbers. */
export function describeLoadFailure(code: number, description: string): string {
  switch (code) {
    case -105: return 'That web address could not be found. Check the spelling.'
    case -102: return 'The site refused the connection.'
    case -106: return 'There is no internet connection.'
    case -118: return 'The site took too long to answer.'
    case -200: case -201: case -202: return 'The security certificate of the site is not valid.'
    case -324: return 'The site closed the connection without answering.'
    default: return `The page could not be loaded${description ? ` (${description.replace(/^net::/, '')})` : ''}.`
  }
}

/** The part of a window the navigation guard needs. */
export interface Navigating {
  on(event: 'will-navigate' | 'will-redirect', listener: (event: { preventDefault(): void }, url: string) => void): unknown
}

/** Stops a page from going anywhere but a web address, whether by a link, a script or a redirect. */
export function restrictToWeb(contents: Navigating): void {
  const guard = (event: { preventDefault(): void }, url: string) => {
    if (!isWebAddress(url)) event.preventDefault()
  }
  contents.on('will-navigate', guard)
  contents.on('will-redirect', guard)
}

/** The part of a rectangle that lies inside a picture of this size, or null if none of it does. */
export function regionWithin(
  rect: { x: number; y: number; width: number; height: number },
  size: { width: number; height: number },
): { x: number; y: number; width: number; height: number } | null {
  const x = Math.max(0, Math.floor(rect.x))
  const y = Math.max(0, Math.floor(rect.y))
  const right = Math.min(size.width, Math.ceil(rect.x + rect.width))
  const bottom = Math.min(size.height, Math.ceil(rect.y + rect.height))
  if (!Number.isFinite(x + y + right + bottom) || right <= x || bottom <= y) return null
  return { x, y, width: right - x, height: bottom - y }
}

export function createPageView(spec: BrowserSpec): PageView {
  const win = new BrowserWindow({
    show: false,
    width: spec.width,
    height: spec.height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    skipTaskbar: true,
    focusable: false,
    webPreferences: {
      offscreen: true,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      // Its own session, not saved: a page cannot see the app's data or keep its own.
      partition: 'cb-browser-source',
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  })

  const wc = win.webContents
  win.setContentSize(spec.width, spec.height)
  wc.setFrameRate(spec.fps)
  wc.setAudioMuted(true)

  // Nothing the page asks for beyond showing itself is granted.
  wc.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  wc.session.setPermissionCheckHandler(() => false)
  wc.session.on('will-download', (event) => event.preventDefault())
  wc.setWindowOpenHandler(() => ({ action: 'deny' }))

  restrictToWeb(wc)

  let frame: (update: PageUpdate) => void = () => {}
  let failure: (message: string) => void = () => {}

  // Each paint is the whole picture with the rectangle that changed. Only that
  // rectangle is sent on, which is what makes an animated overlay affordable.
  let first = true
  wc.on('paint', (_event, dirty, image) => {
    const size = image.getSize()
    if (size.width <= 0 || size.height <= 0) return

    if (size.width !== spec.width || size.height !== spec.height) {
      // The system did not give the window the size asked for; the page is laid out for the size
      // it got, so show it whole at that size.
      frame({ width: size.width, height: size.height, x: 0, y: 0, w: size.width, h: size.height, bgra: image.toBitmap() })
      first = false
      return
    }

    const region = first ? { x: 0, y: 0, width: size.width, height: size.height } : regionWithin(dirty, size)
    first = false
    if (!region) return

    const whole = region.width === size.width && region.height === size.height
    const part = whole ? image : image.crop(region)
    frame({ width: size.width, height: size.height, x: region.x, y: region.y, w: region.width, h: region.height, bgra: part.toBitmap() })
  })
  wc.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
    // -3 is a load that was cancelled by another one starting; not a failure.
    if (isMainFrame && code !== -3) failure(describeLoadFailure(code, description))
  })
  wc.on('render-process-gone', () => failure('The page stopped working.'))

  void wc.loadURL(spec.url).catch(() => { /* reported through did-fail-load */ })

  return {
    onFrame: (cb) => { frame = cb },
    onFailure: (cb) => { failure = cb },
    reload: () => { if (!wc.isDestroyed()) wc.reloadIgnoringCache() },
    destroy: () => { if (!win.isDestroyed()) win.destroy() },
  }
}
