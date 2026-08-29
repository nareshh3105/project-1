import { app } from 'electron'
import electronUpdater from 'electron-updater'
import { command, emit } from '../ipc'

const { autoUpdater } = electronUpdater

let wired = false

/**
 * Wiring is deferred until the first check so that an unconfigured or
 * unreachable feed cannot interfere with startup.
 */
function wire() {
  if (wired) return
  wired = true

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('download-progress', (p) => {
    emit('updater:download-progress', {
      downloaded: p.transferred,
      total: p.total ?? null,
    })
  })
}

export function registerUpdaterCommands() {
  command('check_for_updates', async () => {
    // An unsigned or unpublished build has no feed to consult. Returning null
    // rather than throwing keeps "Check for Updates" from surfacing an error
    // that the user cannot act on.
    if (!app.isPackaged) return null

    wire()
    try {
      const result = await autoUpdater.checkForUpdates()
      if (!result?.updateInfo) return null

      const { version, releaseNotes, releaseDate } = result.updateInfo
      if (version === app.getVersion()) return null

      return {
        version,
        currentVersion: app.getVersion(),
        notes: typeof releaseNotes === 'string' ? releaseNotes : null,
        pubDate: releaseDate ?? null,
      }
    } catch {
      return null
    }
  })

  command('install_update', async () => {
    if (!app.isPackaged) throw new Error('Updates are only available in a packaged build')

    wire()
    await autoUpdater.downloadUpdate()
    autoUpdater.quitAndInstall()
  })
}
