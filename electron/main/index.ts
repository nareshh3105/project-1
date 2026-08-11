import { app, BrowserWindow, Menu, shell } from 'electron'
import windowStateKeeper from 'electron-window-state'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { installDispatcher } from './ipc'
import { registerCommands } from './commands'
import { initDatabase, closeDatabase } from './db'

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
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // required for the preload to import 'electron'
      webSecurity: true,
    },
  })

  state.manage(win)

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

app.whenReady().then(() => {
  // The interface draws its own menu bar. Electron's default native menu would
  // otherwise sit above it, duplicating File/Edit/View.
  Menu.setApplicationMenu(null)

  initDatabase()
  registerCommands()
  installDispatcher()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  closeDatabase()
})
