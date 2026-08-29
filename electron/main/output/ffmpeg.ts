import { spawn, spawnSync, type ChildProcessByStdio } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'

/** stdout is discarded, so it is null; stdin and stderr are pipes. */
type FfmpegProcess = ChildProcessByStdio<Writable, null, Readable>
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

export const RECORDING_STATUS_EVENT = 'output:recording-status'
// The renderer listens on 'output:stream-status' (IPC_EVENTS.STREAM_STATUS).
// The Rust backend emitted 'output:streaming-status', which never matched, so
// streaming status never reached the interface: the Stop button stayed hidden
// and the elapsed timer never started. Emit the name the renderer expects.
export const STREAMING_STATUS_EVENT = 'output:stream-status'
export const REPLAY_STATUS_EVENT = 'output:replay-status'
export const VIRTUAL_CAMERA_STATUS_EVENT = 'output:virtual-camera-status'
export const STATS_UPDATE_EVENT = 'stats:update'

export const FFMPEG_MISSING =
  'ffmpeg not found in PATH. Download ffmpeg from https://ffmpeg.org and add it to PATH.'

/** Screen capture input, identical for every output path. */
export const DESKTOP_INPUT = [
  '-f', 'gdigrab',
  '-framerate', '30',
  '-draw_mouse', '1',
  '-i', 'desktop',
]

let cachedAvailable: boolean | null = null

export function ffmpegAvailable(recheck = false): boolean {
  if (cachedAvailable !== null && !recheck) return cachedAvailable
  try {
    const r = spawnSync('ffmpeg', ['-version'], { windowsHide: true })
    cachedAvailable = r.status === 0
  } catch {
    cachedAvailable = false
  }
  return cachedAvailable
}

export function requireFfmpeg() {
  if (!ffmpegAvailable()) throw new Error(FFMPEG_MISSING)
}

export function timestamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_` +
    `${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
  )
}

export const videosDir = () => path.join(os.homedir(), 'Videos')

/**
 * Returns `file`, or the first numbered variant that does not already exist.
 *
 * Timestamps resolve to the second, and ffmpeg is invoked with `-y`, so two
 * outputs produced within the same second would otherwise silently overwrite
 * one another. Reachable by stopping and restarting a recording quickly, and
 * easily by pressing the screenshot key twice. FR-5.7 requires that names not
 * collide.
 */
export function uniquePath(file: string): string {
  if (!fs.existsSync(file)) return file

  const dir = path.dirname(file)
  const ext = path.extname(file)
  const stem = path.basename(file, ext)

  for (let n = 2; n < 1000; n++) {
    const candidate = path.join(dir, `${stem}_${n}${ext}`)
    if (!fs.existsSync(candidate)) return candidate
  }
  // Practically unreachable; falling back to a timestamp with milliseconds
  // beats throwing away the user's recording.
  return path.join(dir, `${stem}_${Date.now()}${ext}`)
}

export const defaultRecordingPath = () =>
  uniquePath(path.join(videosDir(), `CodeBuilders_${timestamp()}.mkv`))

export function ensureParentDir(file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
}

// ── Sessions ───────────────────────────────────────────────────────────────

export interface Session {
  child: FfmpegProcess
  /** Tail of FFmpeg's stderr, kept so a failure can be explained. */
  stderr: string[]
  [key: string]: unknown
}

export type SessionKind = 'recording' | 'streaming' | 'replay' | 'virtualCamera'

const sessions = new Map<SessionKind, Session>()

export const getSession = (k: SessionKind) => sessions.get(k)
export const isActive = (k: SessionKind) => sessions.has(k)
export const setSession = (k: SessionKind, s: Session) => sessions.set(k, s)
export const takeSession = (k: SessionKind) => {
  const s = sessions.get(k)
  sessions.delete(k)
  return s
}

const STDERR_LINES = 40

/**
 * Spawn FFmpeg, retaining the tail of stderr.
 *
 * The Rust implementation discarded stderr entirely, so a failed encode
 * surfaced as a bare non-zero exit with nothing to act on. Keeping the last
 * few lines is what lets start/stop report why something did not work.
 */
export function spawnFfmpeg(args: string[]): Session {
  const child: FfmpegProcess = spawn('ffmpeg', args, {
    stdio: ['pipe', 'ignore', 'pipe'],
    windowsHide: true,
  })

  const stderr: string[] = []
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    for (const line of chunk.split(/\r?\n/)) {
      if (!line.trim()) continue
      stderr.push(line)
      if (stderr.length > STDERR_LINES) stderr.shift()
    }
  })

  return { child, stderr }
}

/**
 * Fail fast if FFmpeg dies during startup — a bad device name or unusable
 * output path otherwise leaves the interface showing an active session that
 * never produced anything.
 */
export function assertStartedOk(session: Session, waitMs = 700): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      session.child.off('exit', onExit)
      resolve()
    }, waitMs)

    function onExit(code: number | null) {
      clearTimeout(timer)
      const detail = session.stderr.slice(-6).join('\n').trim()
      reject(
        new Error(
          `ffmpeg exited immediately (code ${code}).` +
            (detail ? `\n${detail}` : ''),
        ),
      )
    }

    session.child.once('exit', onExit)
  })
}

/**
 * Ask FFmpeg to finish and flush the container, then force it after a grace
 * period. Killing outright can leave an unplayable file, since the moov atom
 * or matroska cues are written on shutdown.
 */
export function stopGracefully(session: Session, graceMs = 2000) {
  const { child } = session
  try {
    child.stdin.write('q')
    child.stdin.end()
  } catch {
    /* stdin already gone */
  }

  const timer = setTimeout(() => {
    if (child.exitCode === null) child.kill('SIGKILL')
  }, graceMs)

  child.once('exit', () => clearTimeout(timer))
}

export function killAllSessions() {
  for (const [kind, session] of sessions) {
    stopGracefully(session, 500)
    sessions.delete(kind)
  }
}
