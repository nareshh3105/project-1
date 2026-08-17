import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as cp from '../mocks/child-process'

vi.mock('node:child_process', () => ({
  spawn: cp.spawn,
  spawnSync: cp.spawnSync,
}))

let invoke: (name: string, args?: Record<string, unknown>) => Promise<unknown>
let events: { name: string; payload: unknown }[]
let workDir: string

beforeEach(async () => {
  vi.resetModules()
  cp.resetChildProcessMocks()
  cp.spawnSyncResult.status = 0 // ffmpeg present unless a test says otherwise
  events = []
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-out-'))

  // Every start awaits assertStartedOk's grace window. Waiting it out for real
  // costs well over a minute across this file.
  vi.useFakeTimers()

  const ipc = await import('../../electron/main/ipc')
  const output = await import('../../electron/main/commands/output')

  // Capture emitted events instead of pushing them at a window.
  const { BrowserWindow } = await import('electron')
  ;(BrowserWindow.getAllWindows as ReturnType<typeof vi.fn>).mockReturnValue([
    {
      isDestroyed: () => false,
      webContents: {
        send: (_ch: string, name: string, payload: unknown) =>
          events.push({ name, payload }),
      },
    },
  ])

  output.registerOutputCommands()
  ipc.installDispatcher()

  const { ipcMain } = await import('electron')
  const handler = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1]
  invoke = (name, args = {}) => handler({}, name, args)
})

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true })
  vi.useRealTimers()
})

/**
 * Starts an output and lets assertStartedOk's grace window elapse on the fake
 * clock. Tests that need ffmpeg to fail during startup call invoke() directly
 * so they can emit the exit before the window closes.
 */
async function start(name: string, args: Record<string, unknown> = {}) {
  const promise = invoke(name, args)
  await vi.advanceTimersByTimeAsync(2000)
  return promise
}

const eventNames = () => events.map((e) => e.name)
const lastEvent = (name: string) => events.filter((e) => e.name === name).at(-1)?.payload

describe('check_ffmpeg', () => {
  it('reports availability to the interface', async () => {
    cp.spawnSyncResult.status = 0
    expect(await invoke('check_ffmpeg')).toBe(true)
  })

  it('reports absence', async () => {
    cp.spawnSyncResult.status = 1
    expect(await invoke('check_ffmpeg')).toBe(false)
  })
})

describe('start_recording', () => {
  const outputPath = () => path.join(workDir, 'out.mkv')

  it('spawns ffmpeg capturing the desktop', async () => {
    await start('start_recording', { outputPath: outputPath() })

    expect(cp.argAfter('-f')).toBe('gdigrab')
    expect(cp.argAfter('-i')).toBe('desktop')
  })

  it('writes to the requested file', async () => {
    await start('start_recording', { outputPath: outputPath() })
    expect(cp.lastArgs().at(-1)).toBe(outputPath())
  })

  it('returns the path it is recording to', async () => {
    const result = await start('start_recording', { outputPath: outputPath() })
    expect(result).toBe(outputPath())
  })

  it('announces that recording started', async () => {
    await start('start_recording', { outputPath: outputPath() })

    expect(lastEvent('output:recording-status')).toEqual({
      active: true,
      filePath: outputPath(),
    })
  })

  it('refuses a second recording while one is running', async () => {
    await start('start_recording', { outputPath: outputPath() })

    await expect(
      invoke('start_recording', { outputPath: outputPath() }),
    ).rejects.toMatch(/already active/i)
  })

  it('refuses to start without ffmpeg', async () => {
    cp.spawnSyncResult.status = 1
    await expect(invoke('start_recording', {})).rejects.toMatch(/ffmpeg not found/i)
  })

  it('does not report an active recording when ffmpeg dies at startup', async () => {
    const promise = invoke('start_recording', { outputPath: outputPath() })
    cp.spawned[0].emitStderr('Could not open output file\n')
    cp.spawned[0].exit(1)

    await expect(promise).rejects.toMatch(/exited immediately/)
    expect(eventNames()).not.toContain('output:recording-status')
  })

  it('surfaces ffmpeg stderr in the failure', async () => {
    const promise = invoke('start_recording', { outputPath: outputPath() })
    cp.spawned[0].emitStderr('Unknown encoder libx264\n')
    cp.spawned[0].exit(1)

    await expect(promise).rejects.toMatch(/Unknown encoder libx264/)
  })

  it('adds an input per requested audio device', async () => {
    await start('start_recording', {
      outputPath: outputPath(),
      audioTracks: ['Mic', 'Desktop Audio'],
    })

    const args = cp.lastArgs().join(' ')
    expect(args).toContain('audio=Mic')
    expect(args).toContain('audio=Desktop Audio')
  })

  it('builds a filter graph when a track requests noise suppression', async () => {
    await start('start_recording', {
      outputPath: outputPath(),
      audioTracks: ['Mic'],
      noiseSuppression: [true],
    })

    expect(cp.lastArgs()).toContain('-filter_complex')
    expect(cp.lastArgs().join(' ')).toContain('afftdn')
  })

  it('creates the output directory if it is missing', async () => {
    const nested = path.join(workDir, 'a', 'b', 'rec.mkv')
    await start('start_recording', { outputPath: nested })

    expect(fs.existsSync(path.dirname(nested))).toBe(true)
  })
})

describe('stop_recording', () => {
  it('announces that recording stopped', async () => {
    await start('start_recording', { outputPath: path.join(workDir, 'a.mkv') })

    await invoke('stop_recording')

    expect(lastEvent('output:recording-status')).toEqual({
      active: false,
      filePath: null,
    })
  })

  it('asks ffmpeg to finalise the file rather than killing it', async () => {
    await start('start_recording', { outputPath: path.join(workDir, 'a.mkv') })

    await invoke('stop_recording')

    expect(cp.spawned[0].stdin.write).toHaveBeenCalledWith('q')
  })

  it('allows a new recording afterwards', async () => {
    await start('start_recording', { outputPath: path.join(workDir, 'a.mkv') })
    await invoke('stop_recording')

    const second = path.join(workDir, 'b.mkv')
    await expect(start('start_recording', { outputPath: second })).resolves.toBe(second)
  })

  it('is harmless when nothing is recording', async () => {
    await expect(invoke('stop_recording')).resolves.toBeUndefined()
  })
})

describe('start_streaming', () => {
  it('rejects an empty RTMP URL', async () => {
    await expect(invoke('start_streaming', { rtmpUrl: '  ' })).rejects.toMatch(
      /RTMP URL is required/i,
    )
  })

  it('joins the server URL and stream key', async () => {
    await start('start_streaming', {
      rtmpUrl: 'rtmp://live.example/app',
      streamKey: 'abc123',
    })

    expect(cp.lastArgs().at(-1)).toBe('rtmp://live.example/app/abc123')
  })

  it('does not leave a double slash when the URL has a trailing one', async () => {
    await start('start_streaming', {
      rtmpUrl: 'rtmp://live.example/app/',
      streamKey: 'abc123',
    })

    expect(cp.lastArgs().at(-1)).toBe('rtmp://live.example/app/abc123')
  })

  it('streams to the bare URL when no key is given', async () => {
    await start('start_streaming', { rtmpUrl: 'rtmp://live.example/app' })

    expect(cp.lastArgs().at(-1)).toBe('rtmp://live.example/app')
  })

  it('muxes as FLV, which is what RTMP requires', async () => {
    await start('start_streaming', { rtmpUrl: 'rtmp://x/y' })

    expect(cp.lastArgs()).toContain('flv')
  })

  it('emits the event name the interface listens on', async () => {
    await start('start_streaming', { rtmpUrl: 'rtmp://x/y' })

    // Regression: the Rust build emitted 'output:streaming-status' while the
    // renderer listened on 'output:stream-status', so the Stop button never
    // appeared and the elapsed timer never started.
    expect(eventNames()).toContain('output:stream-status')
  })

  it('refuses a second stream while one is running', async () => {
    await start('start_streaming', { rtmpUrl: 'rtmp://x/y' })

    await expect(invoke('start_streaming', { rtmpUrl: 'rtmp://x/y' })).rejects.toMatch(
      /already active/i,
    )
  })
})

describe('replay buffer', () => {
  it('segments the output into a ring', async () => {
    await start('start_replay_buffer', { bufferSecs: 30 })

    expect(cp.argAfter('-f')).toBe('gdigrab')
    expect(cp.lastArgs()).toContain('segment')
    expect(cp.argAfter('-segment_time')).toBe('5')
  })

  it('keeps enough segments to cover the requested window', async () => {
    await start('start_replay_buffer', { bufferSecs: 30 })

    // 30s / 5s per segment, plus overlap so the newest is never the only copy.
    expect(Number(cp.argAfter('-segment_wrap'))).toBeGreaterThan(6)
  })

  it('defaults to a 30 second buffer', async () => {
    await start('start_replay_buffer', {})
    expect(Number(cp.argAfter('-segment_wrap'))).toBe(9)
  })

  it('announces that the buffer started', async () => {
    await start('start_replay_buffer', {})
    expect(lastEvent('output:replay-status')).toEqual({ active: true })
  })

  it('rejects saving when the buffer is not running', async () => {
    await expect(invoke('save_replay')).rejects.toMatch(/not running/i)
  })
})

describe('save_replay', () => {
  /** Puts the replay buffer into a running state with segments on disk. */
  async function withSegments(count: number) {
    await start('start_replay_buffer', { bufferSecs: 30 })

    const ff = await import('../../electron/main/output/ffmpeg')
    const session = ff.getSession('replay')!
    const dir = session.segmentDir as string
    fs.mkdirSync(dir, { recursive: true })

    for (let i = 0; i < count; i++) {
      const file = path.join(dir, `seg${String(i).padStart(5, '0')}.mkv`)
      fs.writeFileSync(file, 'x')
      // Distinct mtimes so ordering is deterministic.
      const t = new Date(Date.now() - (count - i) * 10_000)
      fs.utimesSync(file, t, t)
    }
    return dir
  }

  it('rejects when no segments have been written yet', async () => {
    await withSegments(0)
    await expect(invoke('save_replay')).rejects.toMatch(/No replay segments/i)
  })

  // The newest file is still being written and has no usable index, so it is
  // dropped — leaving nothing when it was the only one.
  it('rejects when only the in-progress segment exists', async () => {
    await withSegments(1)
    await expect(invoke('save_replay')).rejects.toMatch(/Not enough replay data/i)
  })

  it('concatenates the completed segments', async () => {
    await withSegments(4)
    const dest = path.join(workDir, 'replay.mkv')

    await invoke('save_replay', { outputPath: dest })

    const call = cp.spawnSync.mock.calls.at(-1)!
    expect(call[1]).toEqual(expect.arrayContaining(['-f', 'concat', '-c', 'copy']))
  })

  it('excludes the segment still being written', async () => {
    const dir = await withSegments(4)
    const listPath = path.join(dir, 'filelist.txt')

    // Capture the concat list before the command deletes it.
    let written = ''
    cp.spawnSync.mockImplementationOnce(() => {
      written = fs.readFileSync(listPath, 'utf8')
      return { status: 0, stdout: '', stderr: '' }
    })

    await invoke('save_replay', { outputPath: path.join(workDir, 'r.mkv') })

    expect(written).not.toContain('seg00003.mkv')
    expect(written).toContain('seg00002.mkv')
  })

  it('returns the saved path', async () => {
    await withSegments(4)
    const dest = path.join(workDir, 'replay.mkv')

    expect(await invoke('save_replay', { outputPath: dest })).toBe(dest)
  })

  it('reports a concat failure with ffmpeg output', async () => {
    await withSegments(4)
    cp.spawnSync.mockImplementationOnce(() => ({
      status: 1, stdout: '', stderr: 'Invalid data found when processing input',
    }))

    await expect(
      invoke('save_replay', { outputPath: path.join(workDir, 'r.mkv') }),
    ).rejects.toMatch(/Invalid data found/)
  })

  it('cleans up the concat list afterwards', async () => {
    const dir = await withSegments(4)
    await invoke('save_replay', { outputPath: path.join(workDir, 'r.mkv') })

    expect(fs.existsSync(path.join(dir, 'filelist.txt'))).toBe(false)
  })
})

describe('virtual camera', () => {
  it('publishes an MPEG-TS stream over UDP', async () => {
    await start('start_virtual_camera')

    expect(cp.lastArgs()).toContain('mpegts')
    expect(cp.lastArgs().at(-1)).toBe('udp://127.0.0.1:12345')
  })

  it('returns the URL other applications should consume', async () => {
    const url = await start('start_virtual_camera')
    expect(url).toBe('udp://127.0.0.1:12345')
  })

  it('announces the URL alongside the active flag', async () => {
    await start('start_virtual_camera')

    expect(lastEvent('output:virtual-camera-status')).toEqual({
      active: true,
      url: 'udp://127.0.0.1:12345',
    })
  })

  it('clears the URL when stopped', async () => {
    await start('start_virtual_camera')
    await invoke('stop_virtual_camera')

    expect(lastEvent('output:virtual-camera-status')).toEqual({
      active: false,
      url: null,
    })
  })
})

describe('list_audio_devices', () => {
  const dshowOutput = `
[dshow @ 000] DirectShow video devices (some may be both video and audio devices)
[dshow @ 000]  "Integrated Camera"
[dshow @ 000]     Alternative name "@device_pnp_\\\\?\\usb#vid_0000"
[dshow @ 000] DirectShow audio devices
[dshow @ 000]  "Microphone Array (Realtek Audio)"
[dshow @ 000]     Alternative name "@device_cm_{33D9A762}"
[dshow @ 000]  "Stereo Mix (Realtek Audio)"
`

  it('returns audio device names', async () => {
    cp.spawnSyncResult.stderr = dshowOutput
    expect(await invoke('list_audio_devices')).toEqual([
      'Microphone Array (Realtek Audio)',
      'Stereo Mix (Realtek Audio)',
    ])
  })

  it('excludes video devices listed above the audio section', async () => {
    cp.spawnSyncResult.stderr = dshowOutput
    expect(await invoke('list_audio_devices')).not.toContain('Integrated Camera')
  })

  it('skips the alternative-name lines', async () => {
    cp.spawnSyncResult.stderr = dshowOutput
    const devices = (await invoke('list_audio_devices')) as string[]
    expect(devices.some((d) => d.startsWith('@device'))).toBe(false)
  })

  it('returns nothing when ffmpeg is unavailable', async () => {
    cp.spawnSyncResult.status = 1
    expect(await invoke('list_audio_devices')).toEqual([])
  })

  it('returns an empty list when no devices are present', async () => {
    cp.spawnSyncResult.stderr = '[dshow @ 000] DirectShow audio devices\n'
    expect(await invoke('list_audio_devices')).toEqual([])
  })
})
