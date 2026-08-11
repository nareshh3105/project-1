import { BrowserWindow, ipcMain } from 'electron'

export type CommandHandler = (
  args: Record<string, unknown>,
) => unknown | Promise<unknown>

const registry = new Map<string, CommandHandler>()

/** Register a command callable from the renderer by name. */
export function command(name: string, handler: CommandHandler) {
  if (registry.has(name)) {
    throw new Error(`Command "${name}" is already registered`)
  }
  registry.set(name, handler)
}

export function registeredCommands(): string[] {
  return [...registry.keys()].sort()
}

/**
 * Single dispatch point for every renderer request.
 *
 * Errors are re-thrown as plain strings. Electron serialises a thrown Error
 * by prefixing the renderer-side message with "Error invoking remote method",
 * which would surface in the UI; the frontend's IpcError wrapper expects the
 * bare message.
 */
export function installDispatcher() {
  ipcMain.handle('cb:invoke', async (_event, name: string, args = {}) => {
    const handler = registry.get(name)
    if (!handler) throw `Unknown command: ${name}`

    try {
      return await handler(args ?? {})
    } catch (err) {
      throw err instanceof Error ? err.message : String(err)
    }
  })
}

/** Push an event to every open window. Mirrors Tauri's AppHandle.emit. */
export function emit(event: string, payload: unknown) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('cb:event', event, payload)
    }
  }
}
