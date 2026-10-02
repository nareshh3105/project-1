import { app, clipboard, shell } from 'electron'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { command } from '../ipc'
import { spawnSync } from 'node:child_process'
import { logsDir } from '../diagnostics/logger'
import { formatDiagnostics, readLogTail } from '../diagnostics/report'
import { ffmpegBinary } from '../output/ffmpeg'
import { getDb } from '../db'

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

  // Diagnostics: users need a way to reach the log when reporting a fault.
  command('open_logs_folder', () => openFolder(logsDir()))

  command('get_logs_path', () => logsDir())

  // Everything a bug report needs, put on the clipboard as one block of text.
  // Written from here rather than the renderer, whose clipboard access depends
  // on focus and permission rules that differ between dev and a packaged app.
  command('copy_diagnostics', () => {
    const binary = ffmpegBinary()

    let ffmpegVersion: string | null = null
    try {
      const r = spawnSync(binary, ['-version'], { windowsHide: true, encoding: 'utf8' })
      if (r.status === 0) ffmpegVersion = (r.stdout || '').split(/\r?\n/)[0] || null
    } catch { /* not runnable: reported as not found */ }

    let schemaVersion: number | null = null
    try {
      schemaVersion = getDb().pragma('user_version', { simple: true }) as number
    } catch { /* database not open */ }

    const report = formatDiagnostics({
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron,
      platform: process.platform,
      arch: process.arch,
      osRelease: os.release(),
      totalMemoryMB: Math.round(os.totalmem() / 1024 / 1024),
      ffmpeg: { path: binary, bundled: binary !== 'ffmpeg', version: ffmpegVersion },
      schemaVersion,
      logTail: readLogTail(path.join(logsDir(), 'main.log')),
      generatedAt: new Date(),
    })

    clipboard.writeText(report)
    return report.length
  })
}
