import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Diagnostic logging to a known local location (NF-24).
 *
 * Nothing here leaves the machine. Remote reporting is a separate concern and
 * requires explicit opt-in (DC-14, NF-26); this module only writes to disk, so
 * it can run unconditionally.
 */

export type Level = 'info' | 'warn' | 'error'

const MAX_BYTES = 2 * 1024 * 1024
const KEEP_ROTATIONS = 3

let logFile: string | null = null

export function logsDir(): string {
  // app.getPath('logs') is per-application and platform-correct.
  return app.getPath('logs')
}

export function initLogger(): string {
  const dir = logsDir()
  fs.mkdirSync(dir, { recursive: true })
  logFile = path.join(dir, 'main.log')

  rotateIfLarge()
  write('info', `--- session start | v${app.getVersion()} | ${process.platform} ${process.arch} | electron ${process.versions.electron} ---`)
  return logFile
}

/**
 * Keys whose values must never appear in a log (NF-3, DC-15).
 *
 * Matched case-insensitively against object keys, and as a substring, so
 * `streamKey`, `stream_key` and `rtmpStreamKey` are all covered.
 */
const SECRET_KEYS = ['streamkey', 'stream_key', 'password', 'token', 'secret', 'apikey', 'api_key']

const REDACTED = '[redacted]'

/**
 * An RTMP target is built as `<url>/<key>`, so the full URL carries the secret
 * even when the key itself was passed separately.
 */
function redactRtmp(value: string): string {
  return value.replace(/(rtmps?:\/\/[^\s]*?\/)([^/\s]+)$/i, (_m, prefix) => `${prefix}${REDACTED}`)
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[too deep]'

  if (typeof value === 'string') return redactRtmp(value)
  if (value === null || typeof value !== 'object') return value

  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1))

  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    const lower = key.toLowerCase()
    out[key] = SECRET_KEYS.some((s) => lower.includes(s))
      ? REDACTED
      : redact(v, depth + 1)
  }
  return out
}

function rotateIfLarge() {
  if (!logFile) return
  try {
    if (!fs.existsSync(logFile)) return
    if (fs.statSync(logFile).size < MAX_BYTES) return

    // main.log.2 -> main.log.3, main.log.1 -> main.log.2, main.log -> main.log.1
    for (let i = KEEP_ROTATIONS - 1; i >= 1; i--) {
      const from = `${logFile}.${i}`
      const to = `${logFile}.${i + 1}`
      if (fs.existsSync(from)) fs.renameSync(from, to)
    }
    fs.renameSync(logFile, `${logFile}.1`)
  } catch {
    // A failure to rotate must not take the application down.
  }
}

export function write(level: Level, message: string, detail?: unknown) {
  const line =
    `[${new Date().toISOString()}] ${level.toUpperCase().padEnd(5)} ${message}` +
    (detail === undefined ? '' : ` ${safeStringify(redact(detail))}`)

  // Mirror to the console so it is visible during development.
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.info(line)

  if (!logFile) return
  try {
    rotateIfLarge()
    fs.appendFileSync(logFile, line + '\n', 'utf8')
  } catch {
    // Logging must never throw into the caller.
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    // Circular references, BigInt, and similar.
    return String(value)
  }
}

export const log = {
  info: (message: string, detail?: unknown) => write('info', message, detail),
  warn: (message: string, detail?: unknown) => write('warn', message, detail),
  error: (message: string, detail?: unknown) => write('error', message, detail),
}

/** Test seam — lets a suite direct output at a temporary file. */
export function _setLogFileForTests(file: string | null) {
  logFile = file
}
