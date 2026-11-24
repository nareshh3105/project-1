import path from 'node:path'
import { app, safeStorage, shell } from 'electron'
import { command } from '../ipc'
import { YoutubeAccount } from '../youtube/account'
import type { Privacy } from '../youtube/api'

/**
 * YouTube sign-in and broadcasts. Going live itself is the ordinary stream:
 * the interface takes the address and key a broadcast returns and starts
 * streaming with them, so reconnection and everything else work the same.
 */

let account: YoutubeAccount | null = null

function getAccount(): YoutubeAccount {
  return account ??= new YoutubeAccount({
    fetch: (url, init) => fetch(url, init),
    openBrowser: (url) => shell.openExternal(url),
    now: () => Date.now(),
    configPaths: [
      path.join((process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ?? '', 'youtube-oauth.json'),
      path.join(process.cwd(), 'resources', 'youtube-oauth.json'),
    ],
    env: process.env,
    tokenFile: path.join(app.getPath('userData'), 'youtube.bin'),
    vault: {
      available: () => safeStorage.isEncryptionAvailable(),
      encrypt: (t) => safeStorage.encryptString(t),
      decrypt: (b) => safeStorage.decryptString(b),
    },
  })
}

const PRIVACY: readonly Privacy[] = ['public', 'unlisted', 'private']

export function registerYoutubeCommands() {
  command('youtube_status', () => getAccount().status())
  command('youtube_sign_in', () => getAccount().signIn())
  command('youtube_sign_out', () => getAccount().signOut())
  command('youtube_create_broadcast', ({ title, privacy }) => {
    const p = PRIVACY.includes(privacy as Privacy) ? (privacy as Privacy) : 'unlisted'
    return getAccount().goLive(typeof title === 'string' ? title : '', p)
  })
}
