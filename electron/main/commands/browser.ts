import { webContents } from 'electron'
import { command } from '../ipc'
import { BrowserSources } from '../browser/sources'
import { createPageView } from '../browser/view'
import { HOST_CHANNELS } from '../../../shared/host'

/**
 * Browser sources: web pages drawn into the scene. A window that wants to show
 * one asks here, and is sent its pictures until it stops.
 */

export const browserSources = new BrowserSources({
  createView: createPageView,
  sendFrame: (windowId, id, update) => {
    const target = webContents.fromId(windowId)
    if (target && !target.isDestroyed()) target.send(HOST_CHANNELS.browserFrame, id, update)
  },
  sendFailure: (windowId, id, message) => {
    const target = webContents.fromId(windowId)
    if (target && !target.isDestroyed()) target.send(HOST_CHANNELS.browserFailure, id, message)
  },
})

/** Windows already set to clean up after themselves. */
const watched = new Set<number>()

export function registerBrowserCommands() {
  command('browser_attach', (args, { senderId }) => {
    const spec = browserSources.attach(senderId, args.id, args)

    // A window that closes without saying so must not leave its pages running.
    if (!watched.has(senderId)) {
      watched.add(senderId)
      webContents.fromId(senderId)?.once('destroyed', () => {
        watched.delete(senderId)
        browserSources.detachAll(senderId)
      })
    }
    return spec
  })

  command('browser_detach', (args, { senderId }) => browserSources.detach(senderId, args.id))
  command('browser_reload', (args) => browserSources.reload(args.id))
}

export function shutdownBrowserSources() {
  browserSources.shutdown()
}
