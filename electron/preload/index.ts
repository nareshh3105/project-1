import { contextBridge, ipcRenderer } from 'electron'

/**
 * The only channel the renderer is given. Everything the interface can ask the
 * main process to do goes through `invoke` and is dispatched by command name,
 * mirroring the shape the frontend already uses so that `src/ipc/index.ts` is
 * the single file that had to change during the migration.
 *
 * Node itself is never exposed. If the renderer is ever compromised, it can
 * only reach the commands registered in the main process, not the filesystem.
 */
const api = {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    return ipcRenderer.invoke('cb:invoke', command, args ?? {})
  },

  /** Subscribe to a backend event. Returns an unsubscribe function. */
  on(event: string, callback: (payload: unknown) => void): () => void {
    const listener = (_e: unknown, name: string, payload: unknown) => {
      if (name === event) callback(payload)
    }
    ipcRenderer.on('cb:event', listener)
    return () => ipcRenderer.removeListener('cb:event', listener)
  },
}

contextBridge.exposeInMainWorld('codebuilders', api)

export type CodeBuildersApi = typeof api
