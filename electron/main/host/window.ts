import { app, BrowserWindow } from 'electron'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { log } from '../diagnostics/logger'
import type { HostWindowLike } from './manager'

const dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Runs the output engine, and the graphics process that serves it, ahead of the
 * rest of the app.
 *
 * While an output runs the engine has to build a frame every 33 ms (16 ms at 60),
 * and the interface window is busy with a live preview at the same time. At equal
 * priority the interface won often enough for frames to arrive late, which shows
 * up as a stutter in a stream. "High" is the most an ordinary program may ask for.
 */
export function raiseOutputPriority(pids: number[], setPriority: (pid: number, level: number) => void = os.setPriority): number {
  let raised = 0
  for (const pid of new Set(pids)) {
    if (!Number.isInteger(pid) || pid <= 0) continue
    try {
      setPriority(pid, os.constants.priority.PRIORITY_HIGH)
      raised++
    } catch (err) {
      log.warn('could not raise the priority of an output process', { pid, error: String(err) })
    }
  }
  return raised
}

function gpuProcessIds(): number[] {
  try { return app.getAppMetrics().filter((m) => m.type === 'GPU').map((m) => m.pid) } catch { return [] }
}

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

  win.webContents.once('did-finish-load', () => {
    raiseOutputPriority([win.webContents.getOSProcessId(), ...gpuProcessIds()])
  })

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
