/**
 * Stub for the `electron` module.
 *
 * Main-process code imports Electron for app paths, dialogs and window
 * handles, none of which exist in a plain Node process. Tests alias the
 * module here (see vitest.config.ts) so that logic can be exercised without
 * launching an Electron host.
 *
 * Paths point at an OS temp directory so anything a test writes lands
 * somewhere disposable rather than in the real user profile.
 */
import os from 'node:os'
import path from 'node:path'
import { vi } from 'vitest'

const testRoot = path.join(os.tmpdir(), 'codebuilders-test')

export const app = {
  getPath: vi.fn((name: string) => path.join(testRoot, name)),
  getVersion: vi.fn(() => '0.0.0-test'),
  getName: vi.fn(() => 'CodeBuilders'),
  isPackaged: false,
  whenReady: vi.fn(() => Promise.resolve()),
  on: vi.fn(),
  quit: vi.fn(),
}

export const shell = {
  openPath: vi.fn(() => Promise.resolve('')),
  openExternal: vi.fn(() => Promise.resolve()),
}

export const dialog = {
  showSaveDialog: vi.fn(() => Promise.resolve({ canceled: true, filePath: undefined })),
  showOpenDialog: vi.fn(() => Promise.resolve({ canceled: true, filePaths: [] })),
}

export const globalShortcut = {
  register: vi.fn(() => true),
  unregisterAll: vi.fn(),
  isRegistered: vi.fn(() => false),
}

export const ipcMain = {
  handle: vi.fn(),
  removeHandler: vi.fn(),
}

export const BrowserWindow = Object.assign(
  vi.fn(),
  {
    getAllWindows: vi.fn(() => []),
    getFocusedWindow: vi.fn(() => null),
  },
)

export const Menu = { setApplicationMenu: vi.fn() }

export const screen = {
  getPrimaryDisplay: vi.fn(() => ({ size: { width: 1920, height: 1080 }, scaleFactor: 1 })),
}

export const desktopCapturer = {
  getSources: vi.fn(() => Promise.resolve([])),
}

export default {
  app, shell, dialog, globalShortcut, ipcMain, BrowserWindow, Menu, screen,
  desktopCapturer,
}
