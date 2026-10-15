import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as cp from '../mocks/child-process'

vi.mock('node:child_process', () => ({
  spawn: cp.spawn,
  spawnSync: cp.spawnSync,
}))

/**
 * The output host is the real source of recordings and streams; here it is
 * replaced by a recorder so these tests can check what the commands ask of it,
 * in what order, and how they clean up when it or FFmpeg misbehaves.
 */
const host = vi.hoisted(() => ({
  requests: [] as { method: string; args: any }[],
  log: [] as string[],
  behaviour: (_method: string, _args: unknown): unknown => undefined,
  events: null as unknown as import('node:events').EventEmitter,
}))

/** The camera's own pieces are tested on their own; here only how the output uses them. */
const camera = vi.hoisted(() => ({
  files: { dll: 'c.dll', host: 'h.exe', install: 'i.ps1', uninstall: 'u.ps1' } as unknown,
  installed: true,
  pushed: [] as Buffer[],
  stops: 0,
  startFails: null as Error | null,
  ensureFails: null as Error | null,
  asked: [] as string[],
}))

vi.mock('../../electron/main/vcam/camera', () => ({
  defaultInstallDeps: (confirm: (m: string) => Promise<boolean>) => ({ confirm }),
  ensureInstalled: async () => {
    if (camera.ensureFails) throw camera.ensureFails
    return camera.files
  },
  startCamera: async () => {
    if (camera.startFails) throw camera.startFails
    return { push: (c: Buffer) => { camera.pushed.push(c) }, stop: async () => { camera.stops++ } }
  },
}))

vi.mock('../../electron/main/vcam/install', () => ({
  vcamFiles: () => camera.files,
  vcamState: () => (camera.installed ? 'ready' : 'missing'),
  uninstallCamera: async () => ({ ok: true }),
}))

vi.mock('../../electron/main/host/instance', async () => {
  const { EventEmitter } = await import('node:events')
  host.events = new EventEmitter()
  return {
    getHost: () => ({
      request: async (method: string, args: unknown) => {
        host.requests.push({ method, args })
        host.log.push(`host:${method}`)
        return host.behaviour(method, args)
      },
    }),
    hostEvents: host.events,
  }
})

let invoke: (name: string, args?: Record<string, unknown>) => Promise<unknown>
let events: { name: string; payload: unknown }[]
let workDir: string
let ingest: typeof import('../../electron/main/output/ingest')

beforeEach(async () => {
  vi.resetModules()
  cp.resetChildProcessMocks()
  cp.spawnSyncResult.status = 0 // ffmpeg present unless a test says otherwise
  events = []
  host.requests.length = 0
  host.log.length = 0
  host.behaviour = () => undefined
  camera.pushed.length = 0
  camera.stops = 0
  camera.startFails = null
  camera.ensureFails = null
  camera.installed = true
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-out-'))

  // Starting an output waits out FFmpeg's startup check; doing that for real
  // would cost well over a minute across this file.
  vi.useFakeTimers()

  const ipc = await import('../../electron/main/ipc')
  const output = await import('../../electron/main/commands/output')
  ingest = await import('../../electron/main/output/ingest')

  // Capture emitted events instead of pushing them at a window.
  const { BrowserWindow } = await import('electron')
  ;(BrowserWindow.getAllWindows as ReturnType<typeof vi.fn>).mockReturnValue([
    {
      isDestroyed: () => false,
      webContents: {
        send: (_ch: string, name: string, payload: unknown) => events.push({ name, payload }),
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
 * Starts an output and lets FFmpeg's startup check elapse on the fake clock.
 * Tests that need FFmpeg to fail during startup call invoke() directly so they
 * can emit the exit before the check ends.
 */
async function start(name: string, args: Record<string, unknown> = {}) {
  const promise = invoke(name, args)
  await vi.advanceTimersByTimeAsync(4000)
  return promise
}

/** Stops an output; FFmpeg exits when its input closes. */
async function stop(name: string) {
  const promise = invoke(name)
  await vi.advanceTimersByTimeAsync(100)
  return promise
}

const eventNames = () => events.map((e) => e.name)
const lastEvent = (name: string) => events.filter((e) => e.name === name).at(-1)?.payload
const hostCalls = (method: string) => host.requests.filter((r) => r.method === method)
const child = () => cp.spawned.at(-1)!
const has = (args: string[], ...seq: string[]) => args.some((_, i) => seq.every((s, j) => args[i + j] === s))

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
  const file = () => path.join(workDir, 'out.mkv')

  // The whole point: the recording comes from the host, not from the desktop.
  it('runs ffmpeg on the host\'s stream, not on the screen', async () => {
    await start('start_recording', { outputPath: file() })

    expect(has(cp.lastArgs(), '-i', 'pipe:0')).toBe(true)
    expect(cp.lastArgs()).not.toContain('gdigrab')
    expect(cp.lastArgs()).not.toContain('desktop')
  })

  it('asks the host to open a recording session', async () => {
    await start('start_recording', { outputPath: file() })

    expect(hostCalls('openSession')).toHaveLength(1)
    expect(hostCalls('openSession')[0].args.kind).toBe('recording')
  })

  it('starts ffmpeg before the host, so the first chunk has somewhere to go', async () => {
    host.behaviour = (method) => {
      if (method === 'openSession') host.log.push(`spawned:${cp.spawned.length}`)
    }
    await start('start_recording', { outputPath: file() })

    expect(host.log).toEqual(['host:openSession', 'spawned:1'])
  })

  it('delivers what the host sends to ffmpeg', async () => {
    await start('start_recording', { outputPath: file() })

    expect(ingest.pushChunk('recording', Buffer.from('abc'))).toBe(true)
    expect(child().stdin.write).toHaveBeenCalledWith(Buffer.from('abc'))
  })

  it('passes the encoding settings through, checked', async () => {
    await start('start_recording', {
      outputPath: file(),
      params: { width: 1281, height: 721, fps: 60, videoBitrate: 9_000_000 },
    })

    expect(hostCalls('openSession')[0].args.params).toMatchObject({
      width: 1282, height: 722, fps: 60, videoBitrate: 9_000_000, audio: true,
    })
  })

  it('writes to the requested file', async () => {
    await start('start_recording', { outputPath: file() })
    expect(cp.lastArgs().at(-1)).toBe(file())
  })

  it('returns the path it is recording to', async () => {
    expect(await start('start_recording', { outputPath: file() })).toBe(file())
  })

  it('records to the Videos folder by default', async () => {
    const dest = (await start('start_recording')) as string
    expect(path.basename(path.dirname(dest))).toBe('Videos')
    expect(dest).toMatch(/CodeBuilders_.*\.mkv$/)
  })

  it('writes an MP4 that survives being cut short when asked for one', async () => {
    await start('start_recording', { outputPath: path.join(workDir, 'out.mp4') })
    expect(cp.lastArgs()).toContain('-movflags')
  })

  it('takes the format from the setting when no path is given', async () => {
    const dest = (await start('start_recording', { format: 'mp4' })) as string
    expect(dest).toMatch(/\.mp4$/)
  })

  it('announces that recording started', async () => {
    await start('start_recording', { outputPath: file() })
    expect(lastEvent('output:recording-status')).toEqual({ active: true, filePath: file() })
  })

  it('refuses a second recording while one is running', async () => {
    await start('start_recording', { outputPath: file() })
    await expect(invoke('start_recording', { outputPath: file() })).rejects.toMatch(/already active/i)
  })

  it('refuses to start without ffmpeg', async () => {
    cp.spawnSyncResult.status = 1
    await expect(invoke('start_recording')).rejects.toMatch(/ffmpeg/i)
    expect(cp.spawned).toHaveLength(0)
  })

  it('creates the output directory if it is missing', async () => {
    const nested = path.join(workDir, 'a', 'b', 'out.mkv')
    await start('start_recording', { outputPath: nested })
    expect(fs.existsSync(path.dirname(nested))).toBe(true)
  })

  describe('when it fails to start', () => {
    it('does not report an active recording when ffmpeg dies at startup', async () => {
      const promise = invoke('start_recording', { outputPath: file() })
      const failure = expect(promise).rejects.toMatch(/exited/i)
      await vi.advanceTimersByTimeAsync(10)
      child().exit(1)
      await vi.advanceTimersByTimeAsync(2000)
      await failure

      expect(eventNames()).not.toContain('output:recording-status')
    })

    it('surfaces ffmpeg\'s own explanation', async () => {
      const promise = invoke('start_recording', { outputPath: file() })
      const failure = expect(promise).rejects.toMatch(/Permission denied/)
      await vi.advanceTimersByTimeAsync(10)
      child().emitStderr('C:/out.mkv: Permission denied\n')
      child().exit(1)
      await vi.advanceTimersByTimeAsync(2000)
      await failure
    })

    it('reports the host\'s failure and cleans up ffmpeg', async () => {
      host.behaviour = (method) => {
        if (method === 'openSession') throw new Error('The H.264 encoder is not available.')
      }

      await expect(invoke('start_recording', { outputPath: file() })).rejects.toMatch(/encoder is not available/)

      expect(child().kill).toHaveBeenCalled()
      expect(eventNames()).not.toContain('output:recording-status')
    })

    it('stops routing the host\'s chunks to a process that is gone', async () => {
      host.behaviour = (method) => {
        if (method === 'openSession') throw new Error('nope')
      }
      await invoke('start_recording', { outputPath: file() }).catch(() => {})

      expect(ingest.pushChunk('recording', Buffer.from('x'))).toBe(false)
    })

    it('lets the user try again afterwards', async () => {
      host.behaviour = (method) => {
        if (method === 'openSession') throw new Error('nope')
      }
      await invoke('start_recording', { outputPath: file() }).catch(() => {})

      host.behaviour = () => undefined
      await expect(start('start_recording', { outputPath: file() })).resolves.toBe(file())
    })
  })
})

describe('stop_recording', () => {
  const file = () => path.join(workDir, 'out.mkv')

  it('announces that recording stopped', async () => {
    await start('start_recording', { outputPath: file() })
    await stop('stop_recording')

    expect(lastEvent('output:recording-status')).toEqual({ active: false, filePath: null })
  })

  // The host flushes its encoders first, so the last chunks reach ffmpeg before
  // its input is closed. The other order would cut the end off the recording.
  it('has the host finish before ffmpeg\'s input is closed', async () => {
    await start('start_recording', { outputPath: file() })
    host.behaviour = (method) => {
      if (method === 'closeSession') host.log.push(`stdin-ended:${child().stdin.end.mock.calls.length > 0}`)
    }

    await stop('stop_recording')

    expect(host.log.slice(-2)).toEqual(['host:closeSession', 'stdin-ended:false'])
    expect(child().stdin.end).toHaveBeenCalled()
  })

  // On a piped session stdin carries the data; a 'q' written to it would be
  // read as part of the stream.
  it('ends ffmpeg by closing its input, never by typing q', async () => {
    await start('start_recording', { outputPath: file() })
    await stop('stop_recording')

    expect(child().stdin.write).not.toHaveBeenCalledWith('q')
  })

  it('waits for ffmpeg to finish writing the file', async () => {
    await start('start_recording', { outputPath: file() })
    child().exitsWhenInputCloses = false

    let done = false
    void invoke('stop_recording').then(() => { done = true })
    await vi.advanceTimersByTimeAsync(1000)
    expect(done).toBe(false)

    child().exit(0)
    await vi.advanceTimersByTimeAsync(10)
    expect(done).toBe(true)
  })

  it('forces ffmpeg to stop if it will not finish', async () => {
    await start('start_recording', { outputPath: file() })
    child().exitsWhenInputCloses = false

    const promise = invoke('stop_recording')
    await vi.advanceTimersByTimeAsync(6000)
    await promise

    expect(child().kill).toHaveBeenCalledWith('SIGKILL')
  })

  it('still finishes the file when the host cannot be reached', async () => {
    await start('start_recording', { outputPath: file() })
    host.behaviour = (method) => {
      if (method === 'closeSession') throw new Error('host gone')
    }

    await stop('stop_recording')

    expect(child().stdin.end).toHaveBeenCalled()
    expect(lastEvent('output:recording-status')).toEqual({ active: false, filePath: null })
  })

  it('allows a new recording afterwards', async () => {
    await start('start_recording', { outputPath: file() })
    await stop('stop_recording')

    await expect(start('start_recording', { outputPath: path.join(workDir, 'two.mkv') })).resolves.toBeTruthy()
  })

  it('is harmless when nothing is recording', async () => {
    await expect(stop('stop_recording')).resolves.toBeUndefined()
    expect(hostCalls('closeSession')).toHaveLength(0)
  })

  it('refuses a new recording while the last is still being finished', async () => {
    await start('start_recording', { outputPath: file() })
    child().exitsWhenInputCloses = false
    void invoke('stop_recording')
    await vi.advanceTimersByTimeAsync(50)

    await expect(invoke('start_recording', { outputPath: path.join(workDir, 'two.mkv') })).rejects.toMatch(/still finishing/i)
  })
})

describe('an output that ends by itself', () => {
  it('reports ffmpeg dying mid-recording, with why', async () => {
    await start('start_recording', { outputPath: path.join(workDir, 'out.mkv') })

    child().emitStderr('No space left on device\n')
    child().exit(1)
    await vi.advanceTimersByTimeAsync(10)

    expect(lastEvent('output:recording-status')).toEqual({ active: false, filePath: null })
    const error = lastEvent('output:error') as { kind: string; message: string }
    expect(error.kind).toBe('recording')
    expect(error.message).toContain('No space left on device')
  })

  it('tells the host to let go of it', async () => {
    await start('start_recording', { outputPath: path.join(workDir, 'out.mkv') })
    child().exit(1)
    await vi.advanceTimersByTimeAsync(10)

    expect(hostCalls('closeSession').at(-1)?.args).toEqual({ kind: 'recording' })
  })

  it('lets the user start again', async () => {
    await start('start_recording', { outputPath: path.join(workDir, 'out.mkv') })
    child().exit(1)
    await vi.advanceTimersByTimeAsync(10)

    await expect(start('start_recording', { outputPath: path.join(workDir, 'two.mkv') })).resolves.toBeTruthy()
  })

  // A stream dropping used to leave the interface showing "live" indefinitely.
  it('tells the person why a stream dropped, and that it is reconnecting', async () => {
    await start('start_streaming', { rtmpUrl: 'rtmp://live.example/app', streamKey: 'k' })
    child().emitStderr('Connection reset by peer\n')
    child().exit(1)
    await vi.advanceTimersByTimeAsync(10)

    expect((lastEvent('output:notice') as { message: string }).message).toContain('Connection reset by peer')
    expect(lastEvent('output:stream-status')).toEqual({ active: true })
  })

  it('does not report an error for a normal stop', async () => {
    await start('start_recording', { outputPath: path.join(workDir, 'out.mkv') })
    await stop('stop_recording')

    expect(eventNames()).not.toContain('output:error')
  })

  it('stops the output when the host says its encoder failed', async () => {
    await start('start_recording', { outputPath: path.join(workDir, 'out.mkv') })

    host.events.emit('event', { type: 'sessionError', kind: 'recording', message: 'encoder crashed' })
    await vi.advanceTimersByTimeAsync(100)

    expect((lastEvent('output:error') as { message: string }).message).toContain('encoder crashed')
    expect(lastEvent('output:recording-status')).toEqual({ active: false, filePath: null })
  })
})

describe('start_streaming', () => {
  it('rejects an empty RTMP URL', async () => {
    await expect(invoke('start_streaming', { rtmpUrl: '   ' })).rejects.toMatch(/required/i)
    expect(cp.spawned).toHaveLength(0)
  })

  it('joins the server URL and stream key', async () => {
    await start('start_streaming', { rtmpUrl: 'rtmp://live.example/app', streamKey: 'secret' })
    expect(cp.lastArgs().at(-1)).toBe('rtmp://live.example/app/secret')
  })

  it('does not leave a double slash when the URL has a trailing one', async () => {
    await start('start_streaming', { rtmpUrl: 'rtmp://live.example/app/', streamKey: 'secret' })
    expect(cp.lastArgs().at(-1)).toBe('rtmp://live.example/app/secret')
  })

  it('streams to the bare URL when no key is given', async () => {
    await start('start_streaming', { rtmpUrl: 'rtmp://live.example/app' })
    expect(cp.lastArgs().at(-1)).toBe('rtmp://live.example/app')
  })

  it('muxes as FLV, which is what RTMP requires', async () => {
    await start('start_streaming', { rtmpUrl: 'rtmp://live.example/app' })
    expect(has(cp.lastArgs(), '-f', 'flv')).toBe(true)
  })

  it('copies the host\'s picture instead of encoding it again', async () => {
    await start('start_streaming', { rtmpUrl: 'rtmp://live.example/app' })
    expect(has(cp.lastArgs(), '-c:v', 'copy')).toBe(true)
    expect(cp.lastArgs()).not.toContain('libx264')
  })

  it('asks the host for a streaming session', async () => {
    await start('start_streaming', { rtmpUrl: 'rtmp://live.example/app' })
    expect(hostCalls('openSession')[0].args.kind).toBe('streaming')
  })

  it('emits the event name the interface listens on', async () => {
    await start('start_streaming', { rtmpUrl: 'rtmp://live.example/app' })
    expect(eventNames()).toContain('output:stream-status')
    expect(lastEvent('output:stream-status')).toEqual({ active: true })
  })

  it('refuses a second stream while one is running', async () => {
    await start('start_streaming', { rtmpUrl: 'rtmp://live.example/app' })
    await expect(invoke('start_streaming', { rtmpUrl: 'rtmp://live.example/app' })).rejects.toMatch(/already active/i)
  })

  it('reports a server that refuses the connection', async () => {
    const promise = invoke('start_streaming', { rtmpUrl: 'rtmp://live.example/app', streamKey: 'k' })
    const failure = expect(promise).rejects.toMatch(/Connection refused/)
    await vi.advanceTimersByTimeAsync(500)
    child().emitStderr('Connection to tcp://live.example:1935 failed: Connection refused\n')
    child().exit(1)
    await vi.advanceTimersByTimeAsync(4000)
    await failure
  })

  it('stops cleanly', async () => {
    await start('start_streaming', { rtmpUrl: 'rtmp://live.example/app' })
    await stop('stop_streaming')
    expect(lastEvent('output:stream-status')).toEqual({ active: false })
  })
})

describe('replay buffer', () => {
  it('segments the host\'s stream into a ring', async () => {
    await start('start_replay_buffer', { bufferSecs: 30 })

    expect(has(cp.lastArgs(), '-i', 'pipe:0')).toBe(true)
    expect(has(cp.lastArgs(), '-f', 'segment')).toBe(true)
    expect(has(cp.lastArgs(), '-segment_time', '5')).toBe(true)
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

  it('asks the host for a replay session with sound', async () => {
    await start('start_replay_buffer', {})
    expect(hostCalls('openSession')[0].args).toMatchObject({ kind: 'replay', params: { audio: true } })
  })

  it('announces that the buffer started', async () => {
    await start('start_replay_buffer', {})
    expect(lastEvent('output:replay-status')).toEqual({ active: true })
  })

  it('announces that it stopped, and removes its segments', async () => {
    await start('start_replay_buffer', {})
    const dir = (await import('../../electron/main/output/ffmpeg')).getSession('replay')!.segmentDir as string
    await stop('stop_replay_buffer')

    expect(lastEvent('output:replay-status')).toEqual({ active: false })
    expect(fs.existsSync(dir)).toBe(false)
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
  const LABEL = 'Choose "CodeBuilders Virtual Camera" in your app'

  it('decodes the host\'s picture to raw frames on standard output', async () => {
    await start('start_virtual_camera')

    expect(has(cp.lastArgs(), '-f', 'rawvideo', 'pipe:1')).toBe(true)
    expect(has(cp.lastArgs(), '-i', 'pipe:0')).toBe(true)
  })

  it('hands what ffmpeg writes to the camera', async () => {
    await start('start_virtual_camera')
    cp.spawned.at(-1)!.stdout.emit('data', Buffer.from('frame-bytes'))

    expect(camera.pushed).toEqual([Buffer.from('frame-bytes')])
  })

  it('asks the host for the size the camera sends, without sound', async () => {
    await start('start_virtual_camera', { params: { audio: true, width: 1920, height: 1080, fps: 60, tracks: 3 } })

    expect(hostCalls('openSession')[0].args.params).toMatchObject({ audio: false, tracks: 1, width: 1280, height: 720, fps: 30 })
  })

  it('says which camera to choose in the other app', async () => {
    expect(await start('start_virtual_camera')).toBe(LABEL)
    expect(lastEvent('output:virtual-camera-status')).toEqual({ active: true, url: LABEL })
  })

  it('clears the label when stopped, and stops the camera', async () => {
    await start('start_virtual_camera')
    await stop('stop_virtual_camera')

    expect(lastEvent('output:virtual-camera-status')).toEqual({ active: false, url: null })
    expect(camera.stops).toBe(1)
  })

  it('stops the camera if ffmpeg dies on its own', async () => {
    await start('start_virtual_camera')
    cp.spawned.at(-1)!.exit(1)
    await vi.advanceTimersByTimeAsync(10)

    expect(camera.stops).toBe(1)
    expect(lastEvent('output:virtual-camera-status')).toMatchObject({ active: false })
  })

  it('does not start when it is not installed and the person says no', async () => {
    camera.ensureFails = new Error('The virtual camera was not installed.')

    const outcome = invoke('start_virtual_camera', {}).catch((e) => e)

    expect(String(await outcome)).toMatch(/not installed/)
    expect(cp.spawned).toHaveLength(0)
    expect(hostCalls('openSession')).toHaveLength(0)
  })

  it('does not leave the camera running when the output cannot start', async () => {
    host.behaviour = (method) => { if (method === 'openSession') throw new Error('no encoder') }

    const attempt = invoke('start_virtual_camera', {}).catch((e) => e)
    await vi.advanceTimersByTimeAsync(4000)

    expect(String(await attempt)).toMatch(/no encoder/)
    expect(camera.stops).toBe(1)
  })

  it('passes on a camera that will not start', async () => {
    camera.startFails = new Error('Windows refused')
    const outcome = invoke('start_virtual_camera', {}).catch((e) => e)

    expect(String(await outcome)).toMatch(/Windows refused/)
    expect(cp.spawned).toHaveLength(0)
  })

  it('refuses a second camera', async () => {
    await start('start_virtual_camera')
    await expect(invoke('start_virtual_camera', {})).rejects.toMatch(/already active/)
  })

  it('reports whether it is installed', async () => {
    expect(await invoke('vcam_status')).toBe('ready')
    camera.installed = false
    expect(await invoke('vcam_status')).toBe('missing')
  })

  it('will not be uninstalled while it is running', async () => {
    await start('start_virtual_camera')
    await expect(invoke('vcam_uninstall')).rejects.toMatch(/Stop the virtual camera/)
  })

  it('can be uninstalled when it is not running', async () => {
    await expect(invoke('vcam_uninstall')).resolves.toBeUndefined()
  })
})

describe('several outputs at once', () => {
  it('records and streams together, each with its own ffmpeg and session', async () => {
    await start('start_recording', { outputPath: path.join(workDir, 'out.mkv') })
    await start('start_streaming', { rtmpUrl: 'rtmp://live.example/app' })

    expect(cp.spawned).toHaveLength(2)
    expect(hostCalls('openSession').map((r) => r.args.kind)).toEqual(['recording', 'streaming'])
  })

  it('keeps each output\'s data to itself', async () => {
    await start('start_recording', { outputPath: path.join(workDir, 'out.mkv') })
    await start('start_streaming', { rtmpUrl: 'rtmp://live.example/app' })
    const [recorder, streamer] = cp.spawned

    ingest.pushChunk('recording', Buffer.from('R'))
    ingest.pushChunk('streaming', Buffer.from('S'))

    expect(recorder.stdin.write).toHaveBeenCalledWith(Buffer.from('R'))
    expect(recorder.stdin.write).not.toHaveBeenCalledWith(Buffer.from('S'))
    expect(streamer.stdin.write).toHaveBeenCalledWith(Buffer.from('S'))
  })

  it('stopping one leaves the other running', async () => {
    await start('start_recording', { outputPath: path.join(workDir, 'out.mkv') })
    await start('start_streaming', { rtmpUrl: 'rtmp://live.example/app' })

    await stop('stop_recording')

    expect(ingest.pushChunk('streaming', Buffer.from('S'))).toBe(true)
    expect(ingest.pushChunk('recording', Buffer.from('R'))).toBe(false)
  })
})

describe('keeping up with the frame rate', () => {
  const eventsOf = (name: string) => events.filter((e) => e.name === name).map((e) => e.payload as { kind: string; struggling: boolean; dropRatio: number })
  /** A reading from the host, two seconds after the last. */
  async function reading(kind: string, framesIn: number, framesDropped: number, bytesOut = 0) {
    await vi.advanceTimersByTimeAsync(2000)
    host.events.emit('event', { type: 'stats', kind, framesIn, framesDropped, encodeQueue: 0, bytesOut })
  }

  it('says nothing while the output is keeping up', async () => {
    await start('start_recording', { outputPath: path.join(workDir, 'out.mkv') })
    for (let i = 1; i <= 6; i++) await reading('recording', i * 60, 0)
    expect(eventsOf('output:health')).toEqual([])
  })

  it('says so, once, when most frames are being dropped', async () => {
    await start('start_recording', { outputPath: path.join(workDir, 'out.mkv') })
    await reading('recording', 0, 0)
    await reading('recording', 100, 30)
    await reading('recording', 200, 60)
    await reading('recording', 300, 90)

    const said = eventsOf('output:health')
    expect(said).toHaveLength(1)
    expect(said[0]).toMatchObject({ kind: 'recording', struggling: true })
    expect(said[0].dropRatio).toBeCloseTo(0.3)
  })

  it('says when it has recovered', async () => {
    await start('start_recording', { outputPath: path.join(workDir, 'out.mkv') })
    await reading('recording', 0, 0)
    await reading('recording', 100, 30)
    await reading('recording', 200, 60)
    for (let i = 1; i <= 4; i++) await reading('recording', 200 + i * 100, 60)

    expect(eventsOf('output:health').map((e) => e.struggling)).toEqual([true, false])
  })

  it('ignores readings for an output that is not running', async () => {
    await reading('recording', 0, 0)
    await reading('recording', 100, 50)
    await reading('recording', 200, 100)
    expect(eventsOf('output:health')).toEqual([])
  })

  it('starts afresh for the next recording', async () => {
    await start('start_recording', { outputPath: path.join(workDir, 'a.mkv') })
    await reading('recording', 0, 0)
    await reading('recording', 100, 30)
    await stop('stop_recording')

    // The new one's first reading, compared with the old one's last, would look like a second bad
    // interval; it must be the first reading of a new output, with nothing to compare with.
    await start('start_recording', { outputPath: path.join(workDir, 'b.mkv') })
    await reading('recording', 200, 90)
    expect(eventsOf('output:health')).toEqual([])
  })

  it('reports each output on its own', async () => {
    await start('start_recording', { outputPath: path.join(workDir, 'out.mkv') })
    await start('start_streaming', { rtmpUrl: 'rtmp://live.example/app' })
    await reading('streaming', 0, 0)
    await reading('streaming', 100, 40)
    await reading('streaming', 200, 80)
    await reading('recording', 0, 0)
    await reading('recording', 100, 0)

    expect(eventsOf('output:health').map((e) => e.kind)).toEqual(['streaming'])
  })
})

describe('a recording with several audio tracks', () => {
  const file = () => path.join(workDir, 'tracks.mkv')

  /** Starts it. The pipes are real, so their creation is waited for rather than timed. */
  async function startTracks(tracks: unknown) {
    const promise = invoke('start_recording', { outputPath: file(), params: { tracks } })
    await vi.waitFor(() => expect(cp.spawned.length).toBe(1))
    await vi.advanceTimersByTimeAsync(4000)
    return promise
  }

  const inputs = () => cp.lastArgs().flatMap((a, i) => (a === '-i' ? [cp.lastArgs()[i + 1]] : []))

  it('gives ffmpeg a pipe for each extra track', async () => {
    await startTracks(3)

    expect(inputs()).toHaveLength(3)
    expect(inputs()[0]).toBe('pipe:0')
    expect(inputs().slice(1).every((p) => p.startsWith(String.raw`\\.\pipe\codebuilders-`))).toBe(true)
    expect(inputs()[1]).not.toBe(inputs()[2])
  })

  it('tells the host how many tracks to make', async () => {
    await startTracks(2)
    expect(hostCalls('openSession')[0].args.params.tracks).toBe(2)
    expect(inputs()).toHaveLength(2)
  })

  it('uses no pipes for one track', async () => {
    await startTracks(1)
    expect(inputs()).toEqual(['pipe:0'])
  })

  it('reads a nonsense count as one track', async () => {
    await startTracks('lots')
    expect(inputs()).toEqual(['pipe:0'])
    expect(hostCalls('openSession')[0].args.params.tracks).toBe(1)
  })

  it('routes each track from the host to its own pipe', async () => {
    await startTracks(3)
    expect(ingest.hasSink('recording')).toBe(true)
    expect(ingest.hasSink('recording#2')).toBe(true)
    expect(ingest.hasSink('recording#3')).toBe(true)
    expect(ingest.hasSink('recording#4')).toBe(false)
  })

  it('removes the routes when the recording stops', async () => {
    await startTracks(3)
    // Nothing stands in for ffmpeg here, so each pipe gives up waiting for it.
    const stopping = invoke('stop_recording')
    await vi.advanceTimersByTimeAsync(4000)
    await stopping

    expect(ingest.hasSink('recording')).toBe(false)
    expect(ingest.hasSink('recording#2')).toBe(false)
    expect(ingest.hasSink('recording#3')).toBe(false)
  })

  it('leaves no pipes behind when the host cannot start', async () => {
    host.behaviour = (method) => { if (method === 'openSession') throw new Error('no encoder') }
    const promise = invoke('start_recording', { outputPath: file(), params: { tracks: 3 } })
    const settled = promise.catch((e) => e)
    await vi.waitFor(() => expect(cp.spawned.length).toBe(1))
    await vi.advanceTimersByTimeAsync(100)

    expect(String(await settled)).toMatch(/no encoder/)
    expect(ingest.hasSink('recording#2')).toBe(false)
    expect(ingest.hasSink('recording#3')).toBe(false)
  })
})

describe('a stream whose connection drops', () => {
  const live = () => start('start_streaming', { rtmpUrl: 'rtmp://live.example/app', streamKey: 'key' })
  const notices = () => events.filter((e) => e.name === 'output:notice').map((e) => (e.payload as { message: string }).message)
  const statuses = () => events.filter((e) => e.name === 'output:stream-status').map((e) => (e.payload as { active: boolean }).active)
  const errors = () => events.filter((e) => e.name === 'output:error').map((e) => (e.payload as { message: string }).message)
  const streamSpawns = () => cp.spawned.length

  /** Lets what is waiting on the fake clock, and what it starts, run. */
  const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms)

  it('is not ended: it says it is reconnecting and stays live', async () => {
    await live()
    cp.spawned.at(-1)!.exit(1)
    await tick(10)

    expect(notices()).toEqual([expect.stringMatching(/lost its connection.*reconnect/i)])
    expect(statuses()).toEqual([true])
    expect(errors()).toEqual([])
  })

  it('starts the host again, from a clean session, after the first pause', async () => {
    await live()
    const first = streamSpawns()
    cp.spawned.at(-1)!.exit(1)
    await tick(1500)
    expect(streamSpawns()).toBe(first) // not yet

    await tick(3000)
    expect(streamSpawns()).toBe(first + 1)
    expect(hostCalls('closeSession').length).toBeGreaterThanOrEqual(1)
    expect(hostCalls('openSession')).toHaveLength(2)
    // The old session is closed before the new one opens.
    const order = host.log.filter((l) => l === 'host:closeSession' || l === 'host:openSession')
    expect(order).toEqual(['host:openSession', 'host:closeSession', 'host:openSession'])
  })

  it('goes to the same address with the same key', async () => {
    await live()
    cp.spawned.at(-1)!.exit(1)
    await tick(5000)
    expect(cp.lastArgs().at(-1)).toBe('rtmp://live.example/app/key')
  })

  it('says when it is back', async () => {
    await live()
    cp.spawned.at(-1)!.exit(1)
    await tick(5000)
    expect(notices().at(-1)).toMatch(/is back/)
    expect(statuses()).toEqual([true])
  })

  it('carries data to the new connection', async () => {
    await live()
    cp.spawned.at(-1)!.exit(1)
    await tick(5000)

    expect(ingest.pushChunk('streaming', Buffer.from('after'))).toBe(true)
    expect(cp.spawned.at(-1)!.stdin.write).toHaveBeenCalledWith(Buffer.from('after'))
  })

  it('does not send data anywhere while it is down', async () => {
    await live()
    cp.spawned.at(-1)!.exit(1)
    await tick(10)
    expect(ingest.pushChunk('streaming', Buffer.from('lost'))).toBe(false)
  })

  it('keeps trying, with growing pauses, while the connection stays down', async () => {
    await live()
    host.behaviour = (method) => { if (method === 'openSession') queueMicrotask(() => cp.spawned.at(-1)!.exit(1)) }
    cp.spawned.at(-1)!.exit(1)
    const before = streamSpawns()

    await tick(2500 + 100) // first try
    expect(streamSpawns()).toBe(before + 1)
    await tick(4000 + 3000) // second
    expect(streamSpawns()).toBe(before + 2)
    expect(statuses()).toEqual([true])
  })

  it('gives up after about two minutes and says why', async () => {
    await live()
    host.behaviour = (method) => { if (method === 'openSession') queueMicrotask(() => cp.spawned.at(-1)!.exit(1)) }
    cp.spawned.at(-1)!.exit(1)

    await tick(5 * 60 * 1000)

    expect(statuses().at(-1)).toBe(false)
    expect(errors()).toEqual([expect.stringMatching(/could not be reconnected and has stopped/)])
    const spawnsAfter = streamSpawns()
    await tick(60 * 1000)
    expect(streamSpawns()).toBe(spawnsAfter) // and it really has stopped trying
  })

  it('can be stopped while it is reconnecting', async () => {
    await live()
    cp.spawned.at(-1)!.exit(1)
    await tick(10)
    const spawns = streamSpawns()

    await invoke('stop_streaming')
    await tick(60 * 1000)

    expect(statuses().at(-1)).toBe(false)
    expect(streamSpawns()).toBe(spawns)
    expect(errors()).toEqual([])
  })

  it('refuses a second stream while it is reconnecting', async () => {
    await live()
    cp.spawned.at(-1)!.exit(1)
    await tick(10)
    await expect(invoke('start_streaming', { rtmpUrl: 'rtmp://x/y', streamKey: 'k' })).rejects.toMatch(/already active/)
  })

  it('can be started again after it has been stopped', async () => {
    await live()
    cp.spawned.at(-1)!.exit(1)
    await tick(10)
    await invoke('stop_streaming')

    await expect(live()).resolves.toBeUndefined()
  })

  it('stays down if stopped by the person, as before', async () => {
    await live()
    await stop('stop_streaming')
    const spawns = streamSpawns()
    await tick(60 * 1000)
    expect(streamSpawns()).toBe(spawns)
    expect(notices()).toEqual([])
  })

  it('does not reconnect a recording that ends: that is still an error', async () => {
    await start('start_recording', { outputPath: path.join(workDir, 'r.mkv') })
    cp.spawned.at(-1)!.exit(1)
    await tick(10)

    expect(errors()).toEqual([expect.stringMatching(/recording stopped unexpectedly/)])
    expect(notices()).toEqual([])
  })

  it('still fails at once if the very first connection is refused', async () => {
    host.behaviour = (method) => { if (method === 'openSession') queueMicrotask(() => cp.spawned.at(-1)!.exit(1)) }
    const attempt = invoke('start_streaming', { rtmpUrl: 'rtmp://live.example/app', streamKey: 'bad' }).catch((e) => e)
    await tick(4000)

    expect(String(await attempt)).toMatch(/exited immediately/)
    expect(notices()).toEqual([])
    await tick(60 * 1000)
    expect(streamSpawns()).toBe(1)
  })
})
