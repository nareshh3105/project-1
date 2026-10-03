import { ipcMain } from 'electron'
import { EventEmitter } from 'node:events'
import { HOST_CHANNELS, type HostEvent, type HostResponse } from '../../../shared/host'
import { HostManager } from './manager'
import { createHostWindow } from './window'
import { installIngest } from '../output/ingest'

let manager: HostManager | null = null

/** The one output host. Created on first use; the window is not opened until needed. */
export function getHost(): HostManager {
  return (manager ??= new HostManager(createHostWindow))
}

/** Things the host reports unprompted, such as an encoder failing mid-recording. */
export const hostEvents = new EventEmitter()

/** Subscribes the host's messages to the manager and the output layer. */
export function installHostIpc(): void {
  ipcMain.on(HOST_CHANNELS.ready, (event) => {
    getHost().handleReady(event.sender.id)
  })

  ipcMain.on(HOST_CHANNELS.response, (event, response: HostResponse) => {
    getHost().handleResponse(event.sender.id, response)
  })

  ipcMain.on(HOST_CHANNELS.event, (event, hostEvent: HostEvent) => {
    if (!getHost().isHostSender(event.sender.id)) return
    hostEvents.emit('event', hostEvent)
  })

  installIngest((senderId) => getHost().isHostSender(senderId))
}

export function shutdownHost(): void {
  manager?.shutdown()
}
