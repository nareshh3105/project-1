import { contextBridge, ipcRenderer } from 'electron'
import { SEND_CHANNELS, RECEIVE_CHANNELS } from '../../shared/host'

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

  /**
   * Fire-and-forget message to the main process, for the output host: encoded
   * chunks arrive many times a second and a request/response round trip for
   * each would be wasteful. Only the named host channels are allowed, so a
   * compromised page cannot use this to reach arbitrary handlers.
   */
  send(channel: string, ...args: unknown[]): void {
    if (!SEND_CHANNELS.includes(channel)) throw new Error(`Channel not allowed: ${channel}`)
    ipcRenderer.send(channel, ...args)
  },

  /** Listen on one of the host's receive channels. Returns an unsubscribe function. */
  listen(channel: string, callback: (...args: unknown[]) => void): () => void {
    if (!RECEIVE_CHANNELS.includes(channel)) throw new Error(`Channel not allowed: ${channel}`)
    const listener = (_e: unknown, ...args: unknown[]) => callback(...args)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
}

contextBridge.exposeInMainWorld('codebuilders', api)

export type CodeBuildersApi = typeof api
