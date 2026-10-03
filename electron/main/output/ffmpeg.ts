import { spawn, spawnSync, type ChildProcessByStdio } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'

/** stdout is discarded, so it is null; stdin and stderr are pipes. */
type FfmpegProcess = ChildProcessByStdio<Writable, null, Readable>
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { IPC_EVENTS } from '../../../shared/events'

// Re-exported from the shared table so the renderer cannot drift from these
// names. A mismatch here once hid the Stop button for the whole of a live
// stream, because only one side had been renamed.
export const RECORDING_STATUS_EVENT = IPC_EVENTS.RECORDING_STATUS
export const STREAMING_STATUS_EVENT = IPC_EVENTS.STREAM_STATUS
export const REPLAY_STATUS_EVENT = IPC_EVENTS.REPLAY_STATUS
export const VIRTUAL_CAMERA_STATUS_EVENT = IPC_EVENTS.VCAM_STATUS
export const STATS_UPDATE_EVENT = IPC_EVENTS.STATS_UPDATE
export const OUTPUT_ERROR_EVENT = IPC_EVENTS.OUTPUT_ERROR

export const FFMPEG_MISSING =
  'ffmpeg not found in PATH. Download ffmpeg from https://ffmpeg.org and add it to PATH.'

export interface FfmpegLocation {
  /** Electron's resources directory; undefined outside a packaged app. */
  resourcesPath?: string
  cwd: string
  exists: (file: string) => boolean
}

const BUNDLED = path.join('ffmpeg', 'ffmpeg.exe')

/**
 * Where to find FFmpeg: the copy shipped with the app, then one in a dev
 * checkout, then whatever is on the PATH.
 *
 * It used to be the PATH only, so every tester had to install FFmpeg and edit
 * their environment before recording, streaming, the replay buffer or the
 * virtual camera would work at all. Bundled first also means a different
 * FFmpeg already on the PATH cannot change how the app behaves.
 */
export function resolveFfmpegPath(
  loc: FfmpegLocation = {
    resourcesPath: (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath,
    cwd: process.cwd(),
    exists: fs.existsSync,
  },
): string {
  const candidates = [
    loc.resourcesPath && path.join(loc.resourcesPath, BUNDLED),
    path.join(loc.cwd, 'resources', BUNDLED),
  ]
  for (const candidate of candidates) {
    if (candidate && loc.exists(candidate)) return candidate
  }
  return 'ffmpeg'
}

let cachedBinary: string | null = null

/** The FFmpeg executable to launch. Resolved once; the answer cannot change while running. */
export function ffmpegBinary(): string {
  return (cachedBinary ??= resolveFfmpegPath())
}

let cachedAvailable: boolean | null = null

export function ffmpegAvailable(recheck = false): boolean {
  if (cachedAvailable !== null && !recheck) return cachedAvailable
  try {
    const r = spawnSync(ffmpegBinary(), ['-version'], { windowsHide: true })
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
  /**
   * True when FFmpeg reads its input from standard input (the output host's
   * stream). Such a session must be ended by closing the pipe: the usual "q"
   * written to stdin would be read as data and corrupt the stream.
   */
  piped?: boolean
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
export function spawnFfmpeg(args: string[], options: { piped?: boolean } = {}): Session {
  const child: FfmpegProcess = spawn(ffmpegBinary(), args, {
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

  if (options.piped) {
    // Writing to a pipe whose reader has died raises an 'error' on stdin. With
    // no listener that is an uncaught exception, which takes down the whole
    // application, so it is recorded alongside FFmpeg's own output instead.
    child.stdin.on('error', (e: Error) => {
      stderr.push(`stdin: ${e.message}`)
      if (stderr.length > STDERR_LINES) stderr.shift()
    })
  }

  return options.piped ? { child, stderr, piped: true } : { child, stderr }
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
    // 'q' is a command to FFmpeg only when stdin is not carrying data.
    if (!session.piped) child.stdin.write('q')
    child.stdin.end()
  } catch {
    /* stdin already gone */
  }

  const timer = setTimeout(() => {
    if (child.exitCode === null) child.kill('SIGKILL')
  }, graceMs)

  child.once('exit', () => clearTimeout(timer))
}

/**
 * Ends a piped session: close the pipe so FFmpeg reads end-of-input, finishes
 * the file and exits on its own, and resolve when it has. Forced after the
 * grace period so a stuck process cannot hold a recording open forever.
 *
 * Resolves true if FFmpeg exited by itself in time, false if it had to be killed.
 */
export function finishPiped(session: Session, graceMs = 5000): Promise<boolean> {
  const { child } = session

  return new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve(true)
      return
    }

    let killed = false
    const timer = setTimeout(() => {
      killed = true
      if (child.exitCode === null) child.kill('SIGKILL')
    }, graceMs)

    child.once('exit', () => {
      clearTimeout(timer)
      resolve(!killed)
    })

    try {
      child.stdin.end()
    } catch {
      /* stdin already gone; the exit handler still fires */
    }
  })
}

export function killAllSessions() {
  for (const [kind, session] of sessions) {
    stopGracefully(session, 500)
    sessions.delete(kind)
  }
}
