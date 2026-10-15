import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { command, emit } from '../ipc'
import {
  RECORDING_STATUS_EVENT, STREAMING_STATUS_EVENT,
  REPLAY_STATUS_EVENT, VIRTUAL_CAMERA_STATUS_EVENT, OUTPUT_ERROR_EVENT, OUTPUT_HEALTH_EVENT, OUTPUT_NOTICE_EVENT,
  assertStartedOk, ensureParentDir, ffmpegAvailable, ffmpegBinary, finishPiped,
  getSession, isActive, requireFfmpeg, setRecordingFolder, setSession, spawnFfmpeg, takeSession,
  timestamp, uniquePath, videosDir, type Session,
} from '../output/ffmpeg'
import {
  recordingArgs, streamingArgs, replayArgs, virtualCameraArgs, type RecordingFormat,
} from '../output/pipeArgs'
import { normalizeParams } from '../output/params'
import { registerSink, unregisterSink } from '../output/ingest'
import { createTrackPipe, type TrackPipe } from '../output/trackPipes'
import { OutputHealth } from '../output/health'
import { getHost, hostEvents } from '../host/instance'
import { log } from '../diagnostics/logger'
import { dialog } from 'electron'
import { ensureInstalled, startCamera, defaultInstallDeps } from '../vcam/camera'
import { vcamFiles, vcamState, uninstallCamera } from '../vcam/install'
import { VCAM_WIDTH, VCAM_HEIGHT, VCAM_FPS, VCAM_NAME } from '../vcam/frames'
import type { HostEvent, OutputKind, SessionParams } from '../../../shared/host'

const SEGMENT_SECONDS = 5

/** How long to wait, once the host is sending, to see whether FFmpeg objected. */
const STARTUP_CHECK_MS = { recording: 1200, streaming: 2500, replay: 1000, virtualCamera: 1000 } as const

/** Outputs being shut down. A new one of the same kind must wait for the old to finish. */
const closing = new Set<OutputKind>()

const STATUS_EVENT: Record<OutputKind, string> = {
  recording: RECORDING_STATUS_EVENT,
  streaming: STREAMING_STATUS_EVENT,
  replay: REPLAY_STATUS_EVENT,
  virtualCamera: VIRTUAL_CAMERA_STATUS_EVENT,
}

const LABEL: Record<OutputKind, string> = {
  recording: 'recording',
  streaming: 'stream',
  replay: 'replay buffer',
  virtualCamera: 'virtual camera',
}

function announce(kind: OutputKind, active: boolean, extra: Record<string, unknown> = {}) {
  emit(STATUS_EVENT[kind], { active, ...extra })
}

/** FFmpeg's last few lines, which are usually what explains a failure. */
const detail = (session: Session) => session.stderr.slice(-4).join('\n').trim()

interface OpenOptions {
  kind: OutputKind
  ffmpegArgs: string[]
  params: SessionParams
  /** Kept on the session for later commands (the file written, the segment folder, ...). */
  extra?: Record<string, unknown>
  /** Pipes carrying extra audio tracks, which FFmpeg's arguments already name. */
  pipes?: TrackPipe[]
  /** Called with FFmpeg's standard output, for an output that reads it (the virtual camera). */
  onStdout?: (chunk: Buffer) => void
  /**
   * What to do if FFmpeg stops by itself once the output is running. Without it
   * the output simply ends, with the reason shown. A stream passes one that
   * tries to reconnect.
   */
  onLost?: (session: Session, code: number | null) => void
}

/**
 * Starts an output: FFmpeg waiting for the host's stream, then the host's
 * session that produces it.
 *
 * FFmpeg goes first so the sink exists before the first chunk arrives. If
 * either half fails, both are torn down: a half-started output would show as
 * running in the interface while producing nothing.
 */
async function openOutput(options: OpenOptions): Promise<Session> {
  const { kind, ffmpegArgs, params, extra = {}, pipes = [], onStdout, onLost } = options
  if (closing.has(kind)) throw new Error(`The previous ${LABEL[kind]} is still finishing. Try again in a moment.`)
  requireFfmpeg()

  const session = spawnFfmpeg(ffmpegArgs, { piped: true, stdout: !!onStdout })
  if (onStdout) session.child.stdout?.on('data', onStdout)
  registerSink(kind, session.child.stdin)
  pipes.forEach((pipe, i) => registerSink(`${kind}#${i + 2}`, pipe))

  try {
    await getHost().request('openSession', { kind, params })
    // Errors such as a bad output path or a refused connection only surface once
    // FFmpeg has input to work on, so the check comes after the host starts.
    await assertStartedOk(session, STARTUP_CHECK_MS[kind])
  } catch (err) {
    unregisterSink(kind)
    releasePipes(kind, pipes)
    abandon(session)
    // Best effort: the host may never have opened it.
    void getHost().request('closeSession', { kind }).catch(() => {})
    const reason = err instanceof Error ? err.message : String(err)
    throw new Error(reason)
  }

  const live: Session = { ...session, ...extra, pipes }
  setSession(kind, live)
  watchForExit(kind, live, onLost)
  return live
}

/** Closes the pipes of the extra audio tracks and stops routing to them. */
function releasePipes(kind: OutputKind, pipes: TrackPipe[], destroy = true) {
  pipes.forEach((pipe, i) => {
    unregisterSink(`${kind}#${i + 2}`)
    if (destroy) pipe.destroy()
  })
}

function abandon(session: Session) {
  try { session.child.stdin.end() } catch { /* already closed */ }
  if (session.child.exitCode === null) session.child.kill('SIGKILL')
}

/**
 * Ends an output cleanly: the host flushes its encoders (so the last chunks
 * reach FFmpeg), then the pipe is closed so FFmpeg finishes the file.
 */
async function closeOutput(kind: OutputKind): Promise<Session | undefined> {
  const session = takeSession(kind)
  if (!session) return undefined
  outputHealth.reset(kind)

  closing.add(kind)
  try {
    try {
      await getHost().request('closeSession', { kind })
    } catch (err) {
      // The host is gone or stuck; still finish what FFmpeg already has.
      log.warn(`host did not close the ${kind} session`, { error: String(err) })
    }
    unregisterSink(kind)
    // The host has finished writing every track; closing the pipes lets FFmpeg reach the end of each.
    const pipes = (session.pipes as TrackPipe[] | undefined) ?? []
    releasePipes(kind, pipes, false)
    await Promise.all(pipes.map((p) => p.end()))
    const clean = await finishPiped(session)
    if (!clean) log.warn(`ffmpeg had to be stopped for the ${kind} output`)
    await (session.cleanup as (() => Promise<void>) | undefined)?.()
  } finally {
    closing.delete(kind)
  }
  return session
}

/**
 * If FFmpeg dies while an output is running (a dropped RTMP connection, a full
 * disk) say so. This was never handled: the interface kept showing a stream as
 * live long after it had ended.
 */
function watchForExit(kind: OutputKind, session: Session, onLost?: (session: Session, code: number | null) => void) {
  session.child.once('exit', (code) => {
    if (getSession(kind) !== session) return // a normal stop took it first

    if (onLost) {
      // The caller will try to bring it back; this one is finished with.
      takeSession(kind)
      outputHealth.reset(kind)
      unregisterSink(kind)
      releasePipes(kind, (session.pipes as TrackPipe[] | undefined) ?? [])
      void (session.cleanup as (() => Promise<void>) | undefined)?.()
      log.warn(`${kind} output lost`, { code, ffmpeg: detail(session) })
      onLost(session, code)
      return
    }

    takeSession(kind)
    outputHealth.reset(kind)
    unregisterSink(kind)
    releasePipes(kind, (session.pipes as TrackPipe[] | undefined) ?? [])
    void getHost().request('closeSession', { kind }).catch(() => {})
    void (session.cleanup as (() => Promise<void>) | undefined)?.()

    const why = detail(session)
    log.error(`${kind} output ended unexpectedly`, { code, ffmpeg: why })
    announce(kind, false, kind === 'recording' ? { filePath: null } : kind === 'virtualCamera' ? { url: null } : {})
    emit(OUTPUT_ERROR_EVENT, {
      kind,
      message: `The ${LABEL[kind]} stopped unexpectedly (ffmpeg exit ${code}).${why ? `\n${why}` : ''}`,
    })
  })
}

/** How well each running output keeps up; read by the status bar. */
export const outputHealth = new OutputHealth()

// Readings from the host, and a problem inside it (an encoder failing mid-recording) that ends that output.
hostEvents.on('event', (event: HostEvent) => {
  if (event.type === 'stats') {
    // A reading from an output that has already ended must not bring it back.
    if (!getSession(event.kind)) return
    const changed = outputHealth.record(event.kind, {
      at: Date.now(), framesIn: event.framesIn, framesDropped: event.framesDropped, bytesOut: event.bytesOut,
    })
    if (changed !== null) {
      const m = outputHealth.metrics().find((x) => x.kind === event.kind)
      emit(OUTPUT_HEALTH_EVENT, { kind: event.kind, struggling: changed, dropRatio: m?.recentDropRatio ?? 0 })
    }
    return
  }
  if (event.type !== 'sessionError') return
  const { kind, message } = event
  log.error(`host reported a ${kind} error`, { message })
  emit(OUTPUT_ERROR_EVENT, { kind, message: `The ${LABEL[kind]} failed: ${message}` })
  void stopOutput(kind)
})

/** Tells the interface something about an output that is not an end or a failure. */
function notice(kind: OutputKind, level: 'info' | 'error', message: string) {
  emit(OUTPUT_NOTICE_EVENT, { kind, level, message })
}

/** Streams that lost their connection and are being brought back, by kind. */
const reconnecting = new Map<OutputKind, { cancel(): void }>()

/**
 * How long to wait before each try at reconnecting a stream: soon at first, in
 * case it was a blip, then less often. Together about two minutes, after which
 * the stream is ended and the reason shown.
 */
export const RECONNECT_DELAYS_MS = [2000, 4000, 8000, 15000, 15000, 15000, 15000, 15000, 15000, 15000]

/**
 * Brings back an output whose connection was lost: closes what is left of the
 * host's session, then opens a new one (a new connection needs a new start of the
 * stream) at each step of RECONNECT_DELAYS_MS until one holds.
 */
function reconnect(kind: OutputKind, open: () => Promise<Session>, cause: string) {
  let cancelled = false
  let timer: ReturnType<typeof setTimeout> | null = null
  reconnecting.set(kind, { cancel: () => { cancelled = true; if (timer) clearTimeout(timer) } })

  notice(kind, 'info', `The ${LABEL[kind]} lost its connection (${cause}). Trying to reconnect…`)

  const giveUp = (why: string) => {
    reconnecting.delete(kind)
    announce(kind, false)
    emit(OUTPUT_ERROR_EVENT, { kind, message: `The ${LABEL[kind]} could not be reconnected and has stopped. ${why}`.trim() })
  }

  const attempt = async (n: number): Promise<void> => {
    if (cancelled) return
    try {
      await open()
      if (cancelled) { await closeOutput(kind); return }
      reconnecting.delete(kind)
      notice(kind, 'info', `The ${LABEL[kind]} is back.`)
    } catch (err) {
      if (cancelled) return
      const why = err instanceof Error ? err.message : String(err)
      if (n + 1 >= RECONNECT_DELAYS_MS.length) { giveUp(why); return }
      timer = setTimeout(() => void attempt(n + 1), RECONNECT_DELAYS_MS[n + 1])
    }
  }

  void (async () => {
    // What the host still holds of the old connection has to go first.
    try { await getHost().request('closeSession', { kind }) } catch { /* it may already be gone */ }
    if (cancelled) return
    log.warn(`${kind} reconnecting`, { cause })
    timer = setTimeout(() => void attempt(0), RECONNECT_DELAYS_MS[0])
  })()
}

async function stopOutput(kind: OutputKind) {
  // A stream being reconnected is stopped by giving up on it.
  const waiting = reconnecting.get(kind)
  if (waiting) { waiting.cancel(); reconnecting.delete(kind) }
  await closeOutput(kind)
  announce(kind, false, kind === 'recording' ? { filePath: null } : kind === 'virtualCamera' ? { url: null } : {})
}

function recordingFormat(requested: unknown, file?: string): RecordingFormat {
  if (requested === 'mp4' || requested === 'mkv') return requested
  return file?.toLowerCase().endsWith('.mp4') ? 'mp4' : 'mkv'
}

export function registerOutputCommands() {
  command('check_ffmpeg', () => ffmpegAvailable(true))

  // The folder chosen in Settings. Sent whenever it changes and at startup.
  command('set_recording_folder', ({ folder }) => setRecordingFolder(folder))

  command('get_recording_path', () =>
    uniquePath(path.join(videosDir(), `CodeBuilders_${timestamp()}.mkv`)),
  )

  // ── Recording ────────────────────────────────────────────────────────────

  command('start_recording', async ({ outputPath, format, params }) => {
    if (isActive('recording')) throw new Error('Recording is already active')
    requireFfmpeg()

    const requested = typeof outputPath === 'string' && outputPath ? outputPath : undefined
    const fmt = recordingFormat(format, requested)
    const file = requested ?? uniquePath(path.join(videosDir(), `CodeBuilders_${timestamp()}.${fmt}`))
    ensureParentDir(file)

    const p = normalizeParams(params)
    // Each extra audio track has a pipe of its own for FFmpeg to read.
    const pipes = p.audio ? await Promise.all(Array.from({ length: p.tracks - 1 }, () => createTrackPipe())) : []
    try {
      await openOutput({
        kind: 'recording',
        ffmpegArgs: recordingArgs(file, fmt, p.audioBitrate, pipes.map((x) => x.path)),
        params: p,
        extra: { filePath: file },
        pipes,
      })
    } catch (err) {
      pipes.forEach((x) => x.destroy())
      throw err
    }

    announce('recording', true, { filePath: file })
    return file
  })

  command('stop_recording', async () => {
    await stopOutput('recording')
  })

  // ── Streaming ────────────────────────────────────────────────────────────

  command('start_streaming', async ({ rtmpUrl, streamKey, params }) => {
    if (isActive('streaming') || reconnecting.has('streaming')) throw new Error('Streaming is already active')
    requireFfmpeg()

    const url = String(rtmpUrl ?? '').trim()
    if (!url) throw new Error('RTMP URL is required')

    const key = String(streamKey ?? '').trim()
    const target = key ? `${url.replace(/\/+$/, '')}/${key}` : url

    const p = normalizeParams(params)
    const open = (): Promise<Session> => openOutput({
      kind: 'streaming',
      ffmpegArgs: streamingArgs(target, p.audioBitrate),
      params: p,
      // Once live, a lost connection is retried rather than ending the stream.
      onLost: (session, code) => reconnect('streaming', open, session.stderr.at(-1)?.trim() || `ffmpeg exit ${code}`),
    })
    await open()

    announce('streaming', true)
  })

  command('stop_streaming', async () => {
    await stopOutput('streaming')
  })

  // ── Replay buffer ────────────────────────────────────────────────────────

  command('start_replay_buffer', async ({ bufferSecs, params }) => {
    if (isActive('replay')) throw new Error('Replay buffer is already running')
    requireFfmpeg()

    const secs = Number(bufferSecs) > 0 ? Number(bufferSecs) : 30
    const segmentDir = path.join(os.tmpdir(), `codebuilders_replay_${process.pid}`)
    fs.mkdirSync(segmentDir, { recursive: true })

    // A few segments beyond the window so the one being written is never the
    // only copy of the oldest moment the user asked to keep.
    const maxFiles = Math.floor(secs / SEGMENT_SECONDS) + 3

    await openOutput({
      kind: 'replay',
      ffmpegArgs: replayArgs(segmentDir, SEGMENT_SECONDS, maxFiles),
      params: normalizeParams(params),
      extra: { segmentDir, bufferSecs: secs },
    })

    announce('replay', true)
  })

  command('stop_replay_buffer', async () => {
    const session = await closeOutput('replay')
    if (session) {
      // Waited for, so the buffer is not reported stopped while its segments
      // (up to a few hundred megabytes) are still on disk.
      await fs.promises.rm(session.segmentDir as string, { recursive: true, force: true }).catch(() => {})
    }
    announce('replay', false)
  })

  command('save_replay', ({ outputPath }) => {
    const session = getSession('replay')
    if (!session) throw new Error('Replay buffer is not running')

    const segmentDir = session.segmentDir as string
    const bufferSecs = session.bufferSecs as number

    const segments = fs
      .readdirSync(segmentDir)
      .filter((f) => f.endsWith('.mkv'))
      .map((f) => {
        const full = path.join(segmentDir, f)
        return { path: full, mtime: fs.statSync(full).mtimeMs }
      })
      .sort((a, b) => a.mtime - b.mtime)

    if (segments.length === 0) throw new Error('No replay segments available yet')

    // The newest file is still being written and has no usable index.
    segments.pop()
    if (segments.length === 0) {
      throw new Error('Not enough replay data yet — wait a few more seconds')
    }

    const keep = Math.max(1, Math.floor(bufferSecs / SEGMENT_SECONDS))
    const wanted = segments.slice(Math.max(0, segments.length - keep))

    const listPath = path.join(segmentDir, 'filelist.txt')
    fs.writeFileSync(
      listPath,
      wanted.map((s) => `file '${s.path.replace(/\\/g, '/')}'`).join('\n'),
      'utf8',
    )

    const dest =
      (outputPath as string) ||
      uniquePath(path.join(videosDir(), `Replay_${timestamp()}.mkv`))
    ensureParentDir(dest)

    const result = spawnSync(
      ffmpegBinary(),
      ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', dest],
      { windowsHide: true, encoding: 'utf8' },
    )

    fs.rmSync(listPath, { force: true })

    if (result.status !== 0) {
      const why = (result.stderr || '').trim().split('\n').slice(-4).join('\n')
      throw new Error(
        `ffmpeg concat failed — replay segments may be incomplete.${why ? `\n${why}` : ''}`,
      )
    }

    return dest
  })

  // ── Virtual camera ───────────────────────────────────────────────────────

  command('start_virtual_camera', async ({ params }) => {
    if (isActive('virtualCamera')) throw new Error('Virtual camera is already active')
    requireFfmpeg()

    // Installed once, with the person's say-so; Windows then asks for administrator approval.
    const files = await ensureInstalled(defaultInstallDeps(async (message) => {
      const { response } = await dialog.showMessageBox({
        type: 'question', title: 'Virtual camera', message: 'Install the virtual camera?', detail: message,
        buttons: ['Install', 'Cancel'], defaultId: 0, cancelId: 1, noLink: true,
      })
      return response === 0
    }))

    const camera = await startCamera(files)
    const label = `Choose "${VCAM_NAME}" in your app`

    try {
      await openOutput({
        kind: 'virtualCamera',
        ffmpegArgs: virtualCameraArgs(VCAM_WIDTH, VCAM_HEIGHT, VCAM_FPS),
        // The camera sends one fixed size and no sound.
        params: { ...normalizeParams(params), audio: false, tracks: 1, width: VCAM_WIDTH, height: VCAM_HEIGHT, fps: VCAM_FPS },
        extra: { url: label, cleanup: () => camera.stop() },
        onStdout: camera.push,
      })
    } catch (err) {
      await camera.stop()
      throw err
    }

    announce('virtualCamera', true, { url: label })
    return label
  })

  // Whether the camera is installed, for the interface to say so.
  command('vcam_status', () => (vcamFiles() ? vcamState() : 'unavailable'))

  command('vcam_uninstall', async () => {
    const files = vcamFiles()
    if (!files) throw new Error('This build of CodeBuilders does not include the virtual camera.')
    if (isActive('virtualCamera')) throw new Error('Stop the virtual camera first.')
    const result = await uninstallCamera(files)
    if (!result.ok) throw new Error(result.cancelled ? 'The administrator approval was declined.' : result.message)
  })

  command('stop_virtual_camera', async () => {
    await stopOutput('virtualCamera')
  })
}
