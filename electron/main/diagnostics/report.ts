import fs from 'node:fs'

/**
 * The text a tester pastes into a bug report.
 *
 * A report that says "recording doesn't work" is only actionable alongside the
 * version, the operating system, whether FFmpeg was found and which one, the
 * database version and the recent log. Gathering those by hand is exactly the
 * step people skip, so this collects them in one go.
 *
 * Kept pure (all inputs passed in) so the layout and the scrubbing can be
 * tested without Electron.
 */

export interface DiagnosticsInput {
  appVersion: string
  electronVersion: string
  platform: string
  arch: string
  osRelease: string
  totalMemoryMB: number
  ffmpeg: {
    /** The executable that would be launched. */
    path: string
    /** True when it is the copy shipped with the app rather than one on the PATH. */
    bundled: boolean
    /** First line of `ffmpeg -version`, or null when it would not run. */
    version: string | null
  }
  /** SQLite user_version, or null if the database could not be read. */
  schemaVersion: number | null
  logTail: string[]
  generatedAt: Date
}

const REDACTED = '[redacted]'

/**
 * Removes anything secret-looking from one log line.
 *
 * Lines are redacted when they are written, but this report is the thing that
 * leaves the machine, so it is scrubbed again: a log from an older build, or an
 * error message that quoted a URL, would not have been caught the first time.
 * Over-redacting is the safe direction.
 */
export function scrubLogLine(line: string): string {
  return (
    line
      // Quoted JSON values for secret-named keys.
      .replace(
        /("(?:[^"]*(?:stream_?key|password|token|secret|api_?key)[^"]*)"\s*:\s*)"[^"]*"/gi,
        `$1"${REDACTED}"`,
      )
      // key=value pairs in plain text.
      .replace(
        /\b((?:stream_?key|password|token|secret|api_?key)\s*[=:]\s*)[^\s,;"']+/gi,
        `$1${REDACTED}`,
      )
      // The stream key is the last path segment of an RTMP target.
      .replace(/(rtmps?:\/\/[^\s"']*\/)[^\s"'/]+/gi, `$1${REDACTED}`)
  )
}

/** Last `maxLines` lines of a log file, or [] if it cannot be read. */
export function readLogTail(file: string, maxLines = 80): string[] {
  try {
    const { size } = fs.statSync(file)
    // Only the end of the file: a log can be megabytes and the tail is all that is wanted.
    const WINDOW = 128 * 1024
    const fd = fs.openSync(file, 'r')
    try {
      const start = Math.max(0, size - WINDOW)
      const buffer = Buffer.alloc(size - start)
      fs.readSync(fd, buffer, 0, buffer.length, start)
      const lines = buffer.toString('utf8').split(/\r?\n/).filter(Boolean)
      // A read that began mid-file starts mid-line; drop the fragment.
      if (start > 0) lines.shift()
      return lines.slice(-maxLines)
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return []
  }
}

export function formatDiagnostics(i: DiagnosticsInput): string {
  const ffmpeg = i.ffmpeg.version
    ? `${i.ffmpeg.bundled ? 'bundled' : 'system PATH'} — ${i.ffmpeg.version}`
    : `NOT FOUND (looked for: ${i.ffmpeg.path})`

  const log = i.logTail.length
    ? i.logTail.map(scrubLogLine).join('\n')
    : '(no log entries)'

  return [
    'CodeBuilders diagnostics',
    `Generated: ${i.generatedAt.toISOString()}`,
    '',
    `Version:   ${i.appVersion} (Electron ${i.electronVersion})`,
    `System:    ${i.platform} ${i.arch} (${i.osRelease}), ${i.totalMemoryMB} MB RAM`,
    `FFmpeg:    ${ffmpeg}`,
    `Data:      ${i.schemaVersion === null ? 'unreadable' : `schema v${i.schemaVersion}`}`,
    '',
    `Recent log (last ${i.logTail.length} lines):`,
    log,
    '',
  ].join('\n')
}
