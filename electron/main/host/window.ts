import { BrowserWindow } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { log } from '../diagnostics/logger'
import type { HostWindowLike } from './manager'

const dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Creates the output host window.
 *
 * It must count as a visible window. Web Audio runs at about 72% of real time
 * in a window that is minimized or hidden, which would drag the audio out of
 * step with the picture, so the host is shown, but parked far outside every
 * display where nobody can see it, and kept out of the taskbar and Alt-Tab.
 * Measured: a window parked this way keeps the audio clock at real time.
 */
export function createHostWindow(): HostWindowLike {
  const win = new BrowserWindow({
    x: -32000,
    y: -32000,
    width: 640,
    height: 360,
    show: false,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    // A tool window: left out of Alt-Tab and not minimized by "show desktop".
    type: 'toolbar',
    title: 'CodeBuilders output engine',
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  })

  win.setMenu(null)

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) void win.loadURL(`${devUrl}/host.html`)
  else void win.loadFile(path.join(dirname, '../renderer/host.html'))

  // Visible without taking focus from whatever the user is doing.
  win.showInactive()

  // Surface the host's own problems in the app log: nobody can see its window.
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) log.warn(`[host] ${message}`)
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    log.error('output host crashed', { reason: details.reason })
    if (!win.isDestroyed()) win.destroy()
  })

  return {
    id: win.webContents.id,
    isDestroyed: () => win.isDestroyed(),
    send: (channel, ...args) => win.webContents.send(channel, ...args),
    destroy: () => win.destroy(),
    onClosed: (callback) => { win.once('closed', callback) },
  }
}
