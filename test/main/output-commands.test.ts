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
  it('reports a stream that drops', async () => {
    await start('start_streaming', { rtmpUrl: 'rtmp://live.example/app', streamKey: 'k' })
    child().emitStderr('Connection reset by peer\n')
    child().exit(1)
    await vi.advanceTimersByTimeAsync(10)

    expect(lastEvent('output:stream-status')).toEqual({ active: false })
    expect((lastEvent('output:error') as { message: string }).message).toContain('Connection reset')
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
  it('publishes an MPEG-TS stream over UDP', async () => {
    await start('start_virtual_camera')

    expect(cp.lastArgs()).toContain('mpegts')
    expect(cp.lastArgs().at(-1)).toBe('udp://127.0.0.1:12345')
  })

  it('takes its picture from the host', async () => {
    await start('start_virtual_camera')
    expect(has(cp.lastArgs(), '-i', 'pipe:0')).toBe(true)
  })

  it('asks the host for a session without sound', async () => {
    await start('start_virtual_camera', { params: { audio: true } })
    expect(hostCalls('openSession')[0].args.params.audio).toBe(false)
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
    await stop('stop_virtual_camera')

    expect(lastEvent('output:virtual-camera-status')).toEqual({
      active: false,
      url: null,
    })
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
