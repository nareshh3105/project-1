import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { command, emit } from '../ipc'
import {
  DESKTOP_INPUT, RECORDING_STATUS_EVENT, STREAMING_STATUS_EVENT,
  REPLAY_STATUS_EVENT, VIRTUAL_CAMERA_STATUS_EVENT,
  assertStartedOk, defaultRecordingPath, ensureParentDir, ffmpegAvailable,
  isActive, requireFfmpeg, setSession, spawnFfmpeg, stopGracefully,
  takeSession, timestamp, videosDir, getSession,
} from '../output/ffmpeg'

const VIRTUAL_CAMERA_PORT = 12345
const SEGMENT_SECONDS = 5

/** Encoder arguments shared by the recording and replay paths. */
const X264_ARCHIVE = [
  '-c:v', 'libx264',
  '-preset', 'ultrafast',
  '-crf', '23',
  '-pix_fmt', 'yuv420p',
]

/**
 * Builds the audio portion of a recording command.
 *
 * Each selected device becomes its own input and its own output track, so the
 * result can be re-mixed in post. When any track wants noise suppression the
 * whole set has to go through filter_complex, because mixing filtered and
 * unfiltered streams in a plain -map list is not expressible.
 */
function audioArgs(tracks: string[], ns: boolean[]): { inputs: string[]; output: string[] } {
  const inputs: string[] = []
  for (const device of tracks) {
    inputs.push('-f', 'dshow', '-i', `audio=${device}`)
  }

  const output: string[] = []
  if (tracks.length === 0) {
    output.push('-map', '0:v:0')
    return { inputs, output }
  }

  const encoders = tracks.flatMap((_, i) => [
    `-c:a:${i}`, 'aac', `-b:a:${i}`, '192k',
  ])

  if (ns.some(Boolean)) {
    const filters = tracks.map((_, i) =>
      ns[i]
        ? `[${i + 1}:a:0]afftdn=nf=-25[a${i}]`
        : `[${i + 1}:a:0]acopy[a${i}]`,
    )
    output.push('-filter_complex', filters.join(';'))
    output.push('-map', '0:v:0')
    tracks.forEach((_, i) => output.push('-map', `[a${i}]`))
    output.push(...encoders)
  } else {
    output.push(...encoders)
    output.push('-map', '0:v:0')
    tracks.forEach((_, i) => output.push('-map', `${i + 1}:a:0`))
  }

  return { inputs, output }
}

export function registerOutputCommands() {
  command('check_ffmpeg', () => ffmpegAvailable(true))

  command('get_recording_path', () => defaultRecordingPath())

  // ── Recording ────────────────────────────────────────────────────────────

  command('start_recording', async ({ outputPath, audioTracks, noiseSuppression }) => {
    if (isActive('recording')) throw new Error('Recording is already active')
    requireFfmpeg()

    const file = (outputPath as string) || defaultRecordingPath()
    ensureParentDir(file)

    const tracks = (audioTracks as string[]) ?? []
    const ns = (noiseSuppression as boolean[]) ?? []
    const { inputs, output } = audioArgs(tracks, ns)

    const session = spawnFfmpeg([
      '-y', ...DESKTOP_INPUT, ...inputs, ...X264_ARCHIVE, ...output, file,
    ])

    await assertStartedOk(session)

    setSession('recording', { ...session, filePath: file })
    emit(RECORDING_STATUS_EVENT, { active: true, filePath: file })
    return file
  })

  command('stop_recording', () => {
    const session = takeSession('recording')
    if (session) stopGracefully(session, 2000)
    emit(RECORDING_STATUS_EVENT, { active: false, filePath: null })
  })

  // ── Streaming ────────────────────────────────────────────────────────────

  command('start_streaming', async ({ rtmpUrl, streamKey }) => {
    if (isActive('streaming')) throw new Error('Streaming is already active')
    requireFfmpeg()

    const url = String(rtmpUrl ?? '').trim()
    if (!url) throw new Error('RTMP URL is required')

    const key = String(streamKey ?? '').trim()
    const target = key ? `${url.replace(/\/+$/, '')}/${key}` : url

    const session = spawnFfmpeg([
      '-y', ...DESKTOP_INPUT,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-tune', 'zerolatency',
      '-maxrate', '6000k',
      '-bufsize', '12000k',
      '-pix_fmt', 'yuv420p',
      '-g', '60',
      '-f', 'flv', target,
    ])

    // Give the handshake longer than a local encode — a bad key or unreachable
    // server only fails once the RTMP connection is refused.
    await assertStartedOk(session, 1500)

    setSession('streaming', session)
    emit(STREAMING_STATUS_EVENT, { active: true })
  })

  command('stop_streaming', () => {
    const session = takeSession('streaming')
    if (session) stopGracefully(session, 1000)
    emit(STREAMING_STATUS_EVENT, { active: false })
  })

  // ── Replay buffer ────────────────────────────────────────────────────────

  command('start_replay_buffer', async ({ bufferSecs }) => {
    if (isActive('replay')) throw new Error('Replay buffer is already running')
    requireFfmpeg()

    const secs = Number(bufferSecs) > 0 ? Number(bufferSecs) : 30
    const segmentDir = path.join(os.tmpdir(), `codebuilders_replay_${process.pid}`)
    fs.mkdirSync(segmentDir, { recursive: true })

    // A few segments beyond the window so the one being written is never the
    // only copy of the oldest moment the user asked to keep.
    const maxFiles = Math.floor(secs / SEGMENT_SECONDS) + 3

    const session = spawnFfmpeg([
      '-y', ...DESKTOP_INPUT, ...X264_ARCHIVE,
      '-f', 'segment',
      '-segment_time', String(SEGMENT_SECONDS),
      '-segment_wrap', String(maxFiles),
      '-reset_timestamps', '1',
      path.join(segmentDir, 'seg%05d.mkv'),
    ])

    await assertStartedOk(session)

    setSession('replay', { ...session, segmentDir, bufferSecs: secs })
    emit(REPLAY_STATUS_EVENT, { active: true })
  })

  command('stop_replay_buffer', () => {
    const session = takeSession('replay')
    if (session) {
      stopGracefully(session, 500)
      const dir = session.segmentDir as string
      session.child.once('exit', () => {
        fs.rm(dir, { recursive: true, force: true }, () => {})
      })
    }
    emit(REPLAY_STATUS_EVENT, { active: false })
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
      (outputPath as string) || path.join(videosDir(), `Replay_${timestamp()}.mkv`)
    ensureParentDir(dest)

    const result = spawnSync(
      'ffmpeg',
      ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', dest],
      { windowsHide: true, encoding: 'utf8' },
    )

    fs.rmSync(listPath, { force: true })

    if (result.status !== 0) {
      const detail = (result.stderr || '').trim().split('\n').slice(-4).join('\n')
      throw new Error(
        `ffmpeg concat failed — replay segments may be incomplete.${detail ? `\n${detail}` : ''}`,
      )
    }

    return dest
  })

  // ── Virtual camera ───────────────────────────────────────────────────────

  command('start_virtual_camera', async () => {
    if (isActive('virtualCamera')) throw new Error('Virtual camera is already active')
    requireFfmpeg()

    const url = `udp://127.0.0.1:${VIRTUAL_CAMERA_PORT}`

    const session = spawnFfmpeg([
      '-y', ...DESKTOP_INPUT,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      '-pix_fmt', 'yuv420p',
      '-g', '30',
      '-f', 'mpegts', url,
    ])

    await assertStartedOk(session)

    setSession('virtualCamera', { ...session, url })
    emit(VIRTUAL_CAMERA_STATUS_EVENT, { active: true, url })
    return url
  })

  command('stop_virtual_camera', () => {
    const session = takeSession('virtualCamera')
    if (session) stopGracefully(session, 500)
    emit(VIRTUAL_CAMERA_STATUS_EVENT, { active: false, url: null })
  })

  // ── Audio device enumeration ─────────────────────────────────────────────

  command('list_audio_devices', () => {
    if (!ffmpegAvailable()) return []

    // dshow device listing is written to stderr and always exits non-zero.
    const r = spawnSync(
      'ffmpeg',
      ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'],
      { windowsHide: true, encoding: 'utf8' },
    )

    const out = r.stderr || ''
    const devices: string[] = []
    let inAudio = false

    for (const line of out.split(/\r?\n/)) {
      if (/DirectShow audio devices/i.test(line)) { inAudio = true; continue }
      if (/DirectShow video devices/i.test(line)) { inAudio = false; continue }
      if (!inAudio) continue

      const m = line.match(/"([^"]+)"/)
      if (m && !/Alternative name/i.test(line)) devices.push(m[1])
    }

    return devices
  })
}
