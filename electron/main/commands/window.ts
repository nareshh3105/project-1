import { BrowserWindow, dialog } from 'electron'
import fs from 'node:fs/promises'
import { command } from '../ipc'

const focused = () =>
  BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null

export function registerWindowCommands() {
  command('window_set_fullscreen', ({ fullscreen }) => {
    focused()?.setFullScreen(Boolean(fullscreen))
  })

  command('window_is_fullscreen', () => focused()?.isFullScreen() ?? false)

  command('window_set_always_on_top', ({ alwaysOnTop }) => {
    focused()?.setAlwaysOnTop(Boolean(alwaysOnTop))
  })

  command('window_close', () => {
    focused()?.close()
  })

  // ── File dialogs and text IO ─────────────────────────────────────────────
  // Scene collection import/export. The renderer never touches the filesystem
  // directly; it receives a path the user chose in a native dialog and passes
  // it straight back.

  command('show_save_dialog', async ({ defaultPath, filters }) => {
    const win = focused()
    const opts = {
      defaultPath: defaultPath as string | undefined,
      filters: (filters as { name: string; extensions: string[] }[]) ?? [],
    }
    const result = win
      ? await dialog.showSaveDialog(win, opts)
      : await dialog.showSaveDialog(opts)

    return result.canceled ? null : result.filePath
  })

  command('show_open_dialog', async ({ filters }) => {
    const win = focused()
    const opts = {
      properties: ['openFile' as const],
      filters: (filters as { name: string; extensions: string[] }[]) ?? [],
    }
    const result = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts)

    return result.canceled || result.filePaths.length === 0
      ? null
      : result.filePaths[0]
  })

  command('read_text_file', ({ path }) => fs.readFile(path as string, 'utf8'))

  command('write_text_file', ({ path, contents }) =>
    fs.writeFile(path as string, contents as string, 'utf8'),
  )
}
