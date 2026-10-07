import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { command, emit } from '../ipc'
import {
  RECORDING_STATUS_EVENT, STREAMING_STATUS_EVENT,
  REPLAY_STATUS_EVENT, VIRTUAL_CAMERA_STATUS_EVENT, OUTPUT_ERROR_EVENT, OUTPUT_HEALTH_EVENT,
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
import type { HostEvent, OutputKind, SessionParams } from '../../../shared/host'

const VIRTUAL_CAMERA_PORT = 12345
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
}

/**
 * Starts an output: FFmpeg waiting for the host's stream, then the host's
 * session that produces it.
 *
 * FFmpeg goes first so the sink exists before the first chunk arrives. If
 * either half fails, both are torn down: a half-started output would show as
 * running in the interface while producing nothing.
 */
async function openOutput({ kind, ffmpegArgs, params, extra = {}, pipes = [] }: OpenOptions): Promise<Session> {
  if (closing.has(kind)) throw new Error(`The previous ${LABEL[kind]} is still finishing. Try again in a moment.`)
  requireFfmpeg()

  const session = spawnFfmpeg(ffmpegArgs, { piped: true })
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
  watchForExit(kind, live)
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
function watchForExit(kind: OutputKind, session: Session) {
  session.child.once('exit', (code) => {
    if (getSession(kind) !== session) return // a normal stop took it first

    takeSession(kind)
    outputHealth.reset(kind)
    unregisterSink(kind)
    releasePipes(kind, (session.pipes as TrackPipe[] | undefined) ?? [])
    void getHost().request('closeSession', { kind }).catch(() => {})

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

async function stopOutput(kind: OutputKind) {
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
    if (isActive('streaming')) throw new Error('Streaming is already active')
    requireFfmpeg()

    const url = String(rtmpUrl ?? '').trim()
    if (!url) throw new Error('RTMP URL is required')

    const key = String(streamKey ?? '').trim()
    const target = key ? `${url.replace(/\/+$/, '')}/${key}` : url

    const p = normalizeParams(params)
    await openOutput({ kind: 'streaming', ffmpegArgs: streamingArgs(target, p.audioBitrate), params: p })

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

    const url = `udp://127.0.0.1:${VIRTUAL_CAMERA_PORT}`

    await openOutput({
      kind: 'virtualCamera',
      ffmpegArgs: virtualCameraArgs(url),
      // No sound goes to a camera.
      params: { ...normalizeParams(params), audio: false },
      extra: { url },
    })

    announce('virtualCamera', true, { url })
    return url
  })

  command('stop_virtual_camera', async () => {
    await stopOutput('virtualCamera')
  })
}
