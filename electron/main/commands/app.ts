import { app, shell } from 'electron'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { command } from '../ipc'

function openFolder(dir: string) {
  fs.mkdirSync(dir, { recursive: true })
  return shell.openPath(dir).then((err) => {
    if (err) throw new Error(err)
  })
}

export function registerAppCommands() {
  command('get_app_version', () => app.getVersion())

  command('get_platform_info', () => ({
    os: process.platform,
    arch: process.arch,
    version: os.release(),
  }))

  command('open_recordings_folder', () =>
    openFolder(path.join(app.getPath('videos'))),
  )

  command('open_screenshots_folder', () =>
    openFolder(path.join(app.getPath('pictures'))),
  )
}
