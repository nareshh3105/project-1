import { app, BrowserWindow, Menu, dialog, session, shell } from 'electron'
import windowStateKeeper from 'electron-window-state'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { installDispatcher } from './ipc'
import { registerCommands } from './commands'
import { installDisplayMediaHandler } from './commands/capture'
import { initDatabase, closeDatabase } from './db'
import { killAllSessions, ffmpegBinary, ffmpegAvailable } from './output/ffmpeg'
import { stopStatsPolling } from './commands/stats'
import { unregisterAllShortcuts } from './commands/hotkeys'
import { initLogger, log } from './diagnostics/logger'
import { installCrashHandlers, watchWindow } from './diagnostics/crash'
import { describeStartupFailure } from './startup'
import { installHostIpc, shutdownHost } from './host/instance'
import { registerMediaScheme, installMediaProtocol } from './media/protocol'
import { shutdownBrowserSources } from './commands/browser'

const isDev = !app.isPackaged

// __dirname does not exist in an ESM main process.
const dirname = path.dirname(fileURLToPath(import.meta.url))

function createWindow() {
  const state = windowStateKeeper({
    defaultWidth: 1440,
    defaultHeight: 900,
  })

  const win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 1024,
    minHeight: 600,
    show: false,
    backgroundColor: '#0B0B0F',
    title: 'CodeBuilders',
    webPreferences: {
      preload: path.join(dirname, '../preload/index.mjs'),
      // Security: the renderer gets no direct Node access. Everything goes
      // through the command registry exposed by the preload script.
      // The compositor that feeds recording and streaming runs on timers in
      // this window. By default Chromium slows or stops a page that is
      // minimized or covered, and a recording made then would run at about
      // 1 frame per second (measured: 32 frames drawn in 30 seconds). A
      // recorder has to keep running exactly when the user is looking at
      // something else.
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // required for the preload to import 'electron'
      webSecurity: true,
    },
  })

  state.manage(win)
  watchWindow(win)

  // Avoid the white flash before React paints.
  win.once('ready-to-show', () => win.show())

  // External links open in the user's browser, never in the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(path.join(dirname, '../renderer/index.html'))
  }

  return win
}

initLogger()
installCrashHandlers()

// Keep the page rendering when its window is covered, minimized or in the
// background. Must be set before the app is ready. Verified to matter: with
// these off, a minimized window draws about 1 frame per second.
// Media files are played from our own address scheme, which has to be declared before the app is ready.
registerMediaScheme()

app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')

// A second launch would open the same database file, register the same global
// shortcuts and start competing capture sessions. Hand over to the window that
// is already open instead of starting another copy.
const isPrimaryInstance = app.requestSingleInstanceLock()

if (!isPrimaryInstance) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })
}

app.whenReady().then(() => {
  if (!isPrimaryInstance) return

  // The interface draws its own menu bar. Electron's default native menu would
  // otherwise sit above it, duplicating File/Edit/View.
  Menu.setApplicationMenu(null)

  try {
    initDatabase()
  } catch (err) {
    log.error('database failed to open', { error: String(err) })
    dialog.showErrorBox('CodeBuilders cannot start', describeStartupFailure(err))
    app.quit()
    return
  }
  // Which FFmpeg this run will use, and whether it works. The first question
  // about any recording problem; recording it here means a tester's log answers
  // it without a follow-up.
  log.info(`ffmpeg: ${ffmpegBinary()} (${ffmpegAvailable() ? 'runs' : 'NOT FOUND OR NOT RUNNABLE'})`)

  registerCommands()
  installDisplayMediaHandler(session.defaultSession)
  installMediaProtocol()
  installDispatcher()
  installHostIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  log.info('shutting down: stopping sessions and closing database')
  // Orphaned ffmpeg processes would keep holding the capture device and the
  // output file after the window is gone.
  killAllSessions()
  shutdownHost()
  shutdownBrowserSources()
  stopStatsPolling()
  unregisterAllShortcuts()
  closeDatabase()
})
