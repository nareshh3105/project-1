import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import net from 'node:net'
import { EventEmitter } from 'node:events'
import { FrameSplitter, VCAM_FRAME_BYTES, VCAM_WIDTH, VCAM_HEIGHT } from '../../electron/main/vcam/frames'
import { FrameBridge } from '../../electron/main/vcam/bridge'
import { stateOf, vcamFiles, dllTag } from '../../electron/main/vcam/install'
import { ensureInstalled, type InstallDeps } from '../../electron/main/vcam/camera'
import { describeStartFailure } from '../../electron/main/vcam/host'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * The virtual camera's parts that do not need Windows: cutting FFmpeg's output
 * into whole pictures, serving them to the camera over a local connection, deciding
 * whether the camera is installed, and asking before it is.
 */

describe('the picture size', () => {
  it('is NV12 at 1280x720: one byte of brightness per pixel and half a byte of colour', () => {
    expect(VCAM_WIDTH).toBe(1280)
    expect(VCAM_HEIGHT).toBe(720)
    expect(VCAM_FRAME_BYTES).toBe(1280 * 720 * 1.5)
  })
})

describe('FrameSplitter', () => {
  const frame = (n: number, bytes = 10) => Buffer.alloc(bytes, n)

  function make(bytes = 10) {
    const frames: Buffer[] = []
    const splitter = new FrameSplitter((f) => frames.push(Buffer.from(f)), bytes)
    return { frames, splitter }
  }

  it('hands on a whole frame as it arrives', () => {
    const { frames, splitter } = make()
    splitter.push(frame(1))
    expect(frames).toEqual([frame(1)])
  })

  it('waits for the rest of a frame that comes in pieces', () => {
    const { frames, splitter } = make()
    splitter.push(frame(1, 4))
    expect(frames).toEqual([])
    expect(splitter.partial).toBe(4)
    splitter.push(frame(1, 6))
    expect(frames).toEqual([frame(1)])
    expect(splitter.partial).toBe(0)
  })

  it('cuts several frames out of one big chunk', () => {
    const { frames, splitter } = make()
    splitter.push(Buffer.concat([frame(1), frame(2), frame(3)]))
    expect(frames).toEqual([frame(1), frame(2), frame(3)])
  })

  it('keeps what is left over for the next chunk, never mixing frames', () => {
    const { frames, splitter } = make()
    splitter.push(Buffer.concat([frame(1), frame(2, 3)]))
    splitter.push(frame(2, 7))
    splitter.push(frame(3, 10))
    expect(frames).toEqual([frame(1), frame(2), frame(3)])
  })

  it('copes with a chunk of one byte at a time', () => {
    const { frames, splitter } = make(5)
    for (const b of Buffer.concat([frame(7, 5), frame(8, 5)])) splitter.push(Buffer.from([b]))
    expect(frames).toEqual([frame(7, 5), frame(8, 5)])
  })

  it('ignores an empty chunk', () => {
    const { frames, splitter } = make()
    splitter.push(Buffer.alloc(0))
    expect(frames).toEqual([])
  })
})

describe('FrameBridge', () => {
  let bridge: FrameBridge
  let port: number
  const FRAME = 16

  beforeEach(async () => {
    // A port of our own, so a real camera on the usual one is not disturbed.
    port = 20000 + Math.floor(Math.random() * 20000)
    bridge = new FrameBridge(port, FRAME)
    await bridge.listen()
  })

  afterEach(async () => { await bridge.close() })

  const connect = () => new Promise<{ socket: net.Socket; received: Buffer[] }>((resolve, reject) => {
    const received: Buffer[] = []
    const socket = net.connect(port, '127.0.0.1')
    socket.on('data', (d) => received.push(d))
    socket.once('error', reject)
    socket.once('connect', () => resolve({ socket, received }))
  })
  const settle = () => new Promise((r) => setTimeout(r, 40))

  it('drops pictures when no camera is connected', () => {
    expect(bridge.push(Buffer.alloc(FRAME))).toBe(false)
    expect(bridge.connected).toBe(false)
  })

  it('sends pictures to the camera that connects', async () => {
    const { socket, received } = await connect()
    await settle()
    expect(bridge.connected).toBe(true)

    bridge.push(Buffer.alloc(FRAME, 1))
    bridge.push(Buffer.alloc(FRAME, 2))
    await settle()

    expect(Buffer.concat(received)).toEqual(Buffer.concat([Buffer.alloc(FRAME, 1), Buffer.alloc(FRAME, 2)]))
    socket.destroy()
  })

  it('refuses a piece that is not exactly one picture', async () => {
    const { socket, received } = await connect()
    await settle()

    expect(bridge.push(Buffer.alloc(FRAME - 1))).toBe(false)
    expect(bridge.push(Buffer.alloc(FRAME + 1))).toBe(false)
    await settle()

    expect(received).toEqual([])
    socket.destroy()
  })

  it('serves one camera, and turns a second connection away', async () => {
    const first = await connect()
    await settle()
    const second = await connect().catch(() => null)
    await settle()

    bridge.push(Buffer.alloc(FRAME, 5))
    await settle()

    expect(Buffer.concat(first.received)).toEqual(Buffer.alloc(FRAME, 5))
    expect(second ? Buffer.concat(second.received).length : 0).toBe(0)
    first.socket.destroy(); second?.socket.destroy()
  })

  it('goes on to serve a new camera after the first leaves', async () => {
    const first = await connect()
    await settle()
    first.socket.destroy()
    await settle()
    expect(bridge.connected).toBe(false)

    const again = await connect()
    await settle()
    bridge.push(Buffer.alloc(FRAME, 9))
    await settle()

    expect(Buffer.concat(again.received)).toEqual(Buffer.alloc(FRAME, 9))
    again.socket.destroy()
  })

  it('drops pictures rather than build up a backlog for a camera that is not reading', async () => {
    const { socket } = await connect()
    socket.pause() // a camera that has stopped reading
    await settle()

    let accepted = 0
    for (let i = 0; i < 20000; i++) if (bridge.push(Buffer.alloc(FRAME, 1))) accepted++
    // Far fewer than were offered fit in the socket and its buffers before pushes were refused.
    expect(bridge.stats().dropped).toBeGreaterThan(0)
    expect(accepted).toBeLessThan(20000)
    socket.destroy()
  })

  it('counts what it sent', async () => {
    const { socket } = await connect()
    await settle()
    bridge.push(Buffer.alloc(FRAME))
    expect(bridge.stats()).toMatchObject({ sent: 1, connected: true })
    socket.destroy()
  })

  it('says plainly when its port is taken', async () => {
    const other = new FrameBridge(port, FRAME)
    await expect(other.listen()).rejects.toThrow(/using port/)
  })

  it('listens on the loopback interface only', async () => {
    const server = (bridge as unknown as { server: net.Server }).server
    expect((server.address() as net.AddressInfo).address).toBe('127.0.0.1')
  })

  it('closes cleanly with a camera connected', async () => {
    const { socket } = await connect()
    await settle()
    await expect(bridge.close()).resolves.toBeUndefined()
    socket.destroy()
  })
})

describe('is it installed', () => {
  const exists = (...present: string[]) => (p: string) => present.includes(p)
  const DIR = 'C:\\ProgramData\\CodeBuilders\\vcam\\'

  it('is missing when nothing is registered', () => {
    expect(stateOf(null, 'abc123', exists())).toBe('missing')
  })

  it('is missing when what is registered is not on disk', () => {
    expect(stateOf(`${DIR}CodeBuildersCamera-abc123.dll`, 'abc123', exists())).toBe('missing')
  })

  it('is ready when the registered file is this version', () => {
    const file = `${DIR}CodeBuildersCamera-abc123.dll`
    expect(stateOf(file, 'abc123', exists(file))).toBe('ready')
  })

  it('is outdated when the registered file is another version', () => {
    const file = `${DIR}CodeBuildersCamera-old000.dll`
    expect(stateOf(file, 'abc123', exists(file))).toBe('outdated')
  })

  it('does not mind letter case in the path', () => {
    const file = `${DIR}CODEBUILDERSCAMERA-ABC123.DLL`
    expect(stateOf(file, 'abc123', exists(file))).toBe('ready')
  })

  it('does not take an unrelated DLL for it', () => {
    const file = `${DIR}Other-abc123.dll`
    expect(stateOf(file, 'abc123', exists(file))).toBe('outdated')
  })
})

describe('the files that ship with the app', () => {
  it('are found beside the app, or in resources/vcam', () => {
    const all = (p: string) => /vcam/.test(p)
    expect(vcamFiles('C:\\app\\resources', 'C:\\work', all)?.dll).toBe(path.join('C:\\app\\resources', 'vcam', 'CodeBuildersCamera.dll'))
    expect(vcamFiles(undefined, 'C:\\work', all)?.host).toBe(path.join('C:\\work', 'resources', 'vcam', 'CodeBuildersCameraHost.exe'))
  })

  it('are null if any one is missing', () => {
    expect(vcamFiles('C:\\app\\resources', 'C:\\work', (p) => !p.endsWith('install.ps1'))).toBeNull()
    expect(vcamFiles('C:\\app\\resources', 'C:\\work', () => false)).toBeNull()
  })

  it('are really in the project, so that the installer can include them', () => {
    const files = vcamFiles(undefined, process.cwd())
    expect(files).not.toBeNull()
    expect(fs.statSync(files!.dll).size).toBeGreaterThan(50_000)
  })

  it('give the DLL a name from its contents, so an update is told from the old one', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-tag-'))
    const a = path.join(dir, 'a.dll'); const b = path.join(dir, 'b.dll')
    fs.writeFileSync(a, 'one'); fs.writeFileSync(b, 'two')
    expect(dllTag(a)).toMatch(/^[0-9a-f]{12}$/)
    expect(dllTag(a)).not.toBe(dllTag(b))
    fs.writeFileSync(b, 'one')
    expect(dllTag(a)).toBe(dllTag(b))
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('install under the same name the app looks for', () => {
    const files = vcamFiles(undefined, process.cwd())!
    const script = fs.readFileSync(files.install, 'utf8')
    expect(script).toContain('CodeBuildersCamera-$hash.dll')
    expect(script).toContain('Substring(0, 12)')
  })
})

describe('ensureInstalled', () => {
  const FILES = { dll: 'c.dll', host: 'h.exe', install: 'i.ps1', uninstall: 'u.ps1' }

  function deps(over: Partial<InstallDeps> & { states?: Array<'missing' | 'outdated' | 'ready'> } = {}) {
    const states = [...(over.states ?? ['ready'])]
    const calls = { confirm: [] as string[], install: 0 }
    const d: InstallDeps = {
      files: () => FILES,
      state: () => (states.length > 1 ? states.shift()! : states[0]),
      confirm: async (m) => { calls.confirm.push(m); return true },
      install: async () => { calls.install++; return { ok: true } },
      ...over,
    }
    return { d, calls }
  }

  it('does nothing, and asks nothing, when it is installed', async () => {
    const { d, calls } = deps()
    await expect(ensureInstalled(d)).resolves.toBe(FILES)
    expect(calls.confirm).toEqual([])
    expect(calls.install).toBe(0)
  })

  it('asks first, in plain words, and then installs', async () => {
    const { d, calls } = deps({ states: ['missing', 'ready'] })
    await ensureInstalled(d)
    expect(calls.confirm).toHaveLength(1)
    expect(calls.confirm[0]).toMatch(/administrator approval/)
    expect(calls.confirm[0]).toMatch(/Install it now/)
    expect(calls.install).toBe(1)
  })

  it('asks about an update differently from a first install', async () => {
    const { d, calls } = deps({ states: ['outdated', 'ready'] })
    await ensureInstalled(d)
    expect(calls.confirm[0]).toMatch(/needs updating/)
    expect(calls.confirm[0]).toMatch(/Update it now/)
  })

  it('installs nothing when the person says no', async () => {
    const { d, calls } = deps({ states: ['missing'], confirm: async () => false })
    await expect(ensureInstalled(d)).rejects.toThrow(/was not installed/)
    expect(calls.install).toBe(0)
  })

  it('says so when the administrator approval is declined', async () => {
    const { d } = deps({ states: ['missing'], install: async () => ({ ok: false, cancelled: true, message: 'x' }) })
    await expect(ensureInstalled(d)).rejects.toThrow(/approval was declined/)
  })

  it('passes on why an install failed', async () => {
    const { d } = deps({ states: ['missing'], install: async () => ({ ok: false, cancelled: false, message: 'disk is full' }) })
    await expect(ensureInstalled(d)).rejects.toThrow(/could not be installed. disk is full/)
  })

  it('does not trust an install that left it unfinished', async () => {
    const { d } = deps({ states: ['missing', 'missing'] })
    await expect(ensureInstalled(d)).rejects.toThrow(/did not finish/)
  })

  it('says so when this build has no camera files', async () => {
    const { d } = deps({ files: () => null })
    await expect(ensureInstalled(d)).rejects.toThrow(/does not include the virtual camera/)
  })
})

describe('describing a camera that would not start', () => {
  it('points to reinstalling when Windows cannot find the camera', () => {
    expect(describeStartFailure('MFCreateVirtualCamera failed 0x80070003', 3)).toMatch(/Reinstall/)
  })

  it('says when access was refused', () => {
    expect(describeStartFailure('Start failed 0x80070005', 4)).toMatch(/access denied/)
  })

  it('shows what the program printed otherwise', () => {
    expect(describeStartFailure('Start failed 0x80004005', 4)).toMatch(/exit 4[\s\S]*0x80004005/)
  })

  it('copes with nothing printed', () => {
    expect(describeStartFailure('', null)).toMatch(/could not start \(exit null\)/)
  })
})

// The program that creates the camera, with a fake in its place.
const spawned: Array<EventEmitter & { stdout: EventEmitter & { setEncoding: () => void }; stderr: EventEmitter; stdin: EventEmitter & { end: ReturnType<typeof vi.fn> }; kill: ReturnType<typeof vi.fn> }> = []

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process')
  return {
    ...actual,
    spawn: vi.fn((command: string) => {
      if (!/CodeBuildersCameraHost/.test(command)) return actual.spawn(command)
      const child = Object.assign(new EventEmitter(), {
        stdout: Object.assign(new EventEmitter(), { setEncoding: () => {} }),
        stderr: new EventEmitter(),
        stdin: Object.assign(new EventEmitter(), { end: vi.fn(() => { queueMicrotask(() => child.emit('exit', 0)) }) }),
        kill: vi.fn(() => { child.emit('exit', 1) }),
      })
      spawned.push(child as never)
      return child
    }),
  }
})

describe('the program that creates the camera', () => {
  let startCameraHost: typeof import('../../electron/main/vcam/host')['startCameraHost']

  beforeEach(async () => {
    spawned.length = 0
    vi.useFakeTimers()
    startCameraHost = (await import('../../electron/main/vcam/host')).startCameraHost
  })
  afterEach(() => vi.useRealTimers())

  it('is running once it says the camera started', async () => {
    const started = startCameraHost('C:\\x\\CodeBuildersCameraHost.exe')
    spawned[0].stdout.emit('data', 'camera started\n')
    await expect(started).resolves.toHaveProperty('stop')
  })

  it('is told to stop by closing its input, and the camera goes with it', async () => {
    const started = startCameraHost('C:\\x\\CodeBuildersCameraHost.exe')
    spawned[0].stdout.emit('data', 'camera started\n')
    const host = await started

    await host.stop()
    expect(spawned[0].stdin.end).toHaveBeenCalled()
  })

  it('reports why it could not start, from what it printed', async () => {
    const started = startCameraHost('C:\\x\\CodeBuildersCameraHost.exe')
    const outcome = started.catch((e) => e)
    spawned[0].stdout.emit('data', 'Start failed 0x80070003\n')
    spawned[0].emit('exit', 4)
    expect(String(await outcome)).toMatch(/Reinstall/)
  })

  it('gives up, and ends the program, if it never says', async () => {
    const started = startCameraHost('C:\\x\\CodeBuildersCameraHost.exe')
    const outcome = started.catch((e) => e)
    await vi.advanceTimersByTimeAsync(9000)
    expect(String(await outcome)).toMatch(/did not start in time/)
    expect(spawned[0].kill).toHaveBeenCalled()
  })

  it('can be stopped twice', async () => {
    const started = startCameraHost('C:\\x\\CodeBuildersCameraHost.exe')
    spawned[0].stdout.emit('data', 'camera started\n')
    const host = await started
    await host.stop()
    await expect(host.stop()).resolves.toBeUndefined()
  })
})
