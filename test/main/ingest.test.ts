import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as cp from '../mocks/child-process'

vi.mock('node:child_process', () => ({ spawn: cp.spawn, spawnSync: cp.spawnSync }))

/**
 * The ingest router carries the host's encoded output to FFmpeg. It is also the
 * one place a stray or hostile message could reach a process's input, so what it
 * refuses matters as much as what it delivers.
 */

let ingest: typeof import('../../electron/main/output/ingest')
let ff: typeof import('../../electron/main/output/ffmpeg')

const sink = () => ({ write: vi.fn(), writable: true as boolean | undefined })

beforeEach(async () => {
  vi.resetModules()
  cp.resetChildProcessMocks()
  ingest = await import('../../electron/main/output/ingest')
  ff = await import('../../electron/main/output/ffmpeg')
})

describe('delivering chunks', () => {
  it('writes to the sink for that output', () => {
    const s = sink()
    ingest.registerSink('recording', s)

    expect(ingest.pushChunk('recording', Buffer.from('data'))).toBe(true)
    expect(s.write).toHaveBeenCalledWith(Buffer.from('data'))
  })

  it('keeps each output\'s chunks to itself', () => {
    const rec = sink()
    const str = sink()
    ingest.registerSink('recording', rec)
    ingest.registerSink('streaming', str)

    ingest.pushChunk('streaming', Buffer.from('S'))

    expect(rec.write).not.toHaveBeenCalled()
    expect(str.write).toHaveBeenCalled()
  })

  it('stops delivering after the sink is removed', () => {
    const s = sink()
    ingest.registerSink('recording', s)
    ingest.unregisterSink('recording')

    expect(ingest.pushChunk('recording', Buffer.from('late'))).toBe(false)
    expect(s.write).not.toHaveBeenCalled()
  })

  it('drops a chunk when the process behind the sink has gone', () => {
    const s = sink()
    s.writable = false
    ingest.registerSink('recording', s)

    expect(ingest.pushChunk('recording', Buffer.from('x'))).toBe(false)
    expect(s.write).not.toHaveBeenCalled()
  })

  it('drops a chunk for an output that is not running', () => {
    expect(ingest.pushChunk('recording', Buffer.from('x'))).toBe(false)
  })
})

describe('what it refuses', () => {
  beforeEach(() => ingest.registerSink('recording', sink()))

  it.each(['', 'recordings', 'constructor', '__proto__', 'RECORDING'])('an output named %j', (kind) => {
    expect(ingest.pushChunk(kind, Buffer.from('x'))).toBe(false)
  })

  it.each([['a string', 'text'], ['a number', 5], ['null', null], ['an object', { length: 3 }], ['an array', [1, 2]]])(
    'data that is %s',
    (_label, data) => {
      expect(ingest.pushChunk('recording', data)).toBe(false)
    },
  )

  it('an empty chunk', () => {
    expect(ingest.pushChunk('recording', Buffer.alloc(0))).toBe(false)
  })
})

describe('the byte containers Electron can deliver', () => {
  it('takes a Buffer as it is', () => {
    const b = Buffer.from('abc')
    expect(ingest.toBuffer(b)).toBe(b)
  })

  it('takes an ArrayBuffer', () => {
    const ab = new Uint8Array([1, 2, 3]).buffer
    expect([...ingest.toBuffer(ab)!]).toEqual([1, 2, 3])
  })

  it('takes a view without copying in bytes from outside it', () => {
    const backing = new Uint8Array([9, 9, 1, 2, 3, 9, 9])
    const view = backing.subarray(2, 5)
    expect([...ingest.toBuffer(view)!]).toEqual([1, 2, 3])
  })

  it('rejects anything else', () => {
    expect(ingest.toBuffer('x')).toBeNull()
    expect(ingest.toBuffer(undefined)).toBeNull()
  })
})

describe('only the host may feed an output', () => {
  async function listener(isHost: (id: number) => boolean) {
    const { ipcMain } = await import('electron')
    ingest.installIngest(isHost)
    const calls = (ipcMain.on as ReturnType<typeof vi.fn>).mock.calls
    return calls.find((c) => c[0] === 'cb:ingest')![1] as (e: unknown, kind: string, data: unknown) => void
  }

  it('delivers a chunk from the host', async () => {
    const s = sink()
    ingest.registerSink('recording', s)
    const handle = await listener((id) => id === 7)

    handle({ sender: { id: 7 } }, 'recording', Buffer.from('ok'))

    expect(s.write).toHaveBeenCalled()
  })

  it('ignores a chunk from any other page', async () => {
    const s = sink()
    ingest.registerSink('recording', s)
    const handle = await listener((id) => id === 7)

    handle({ sender: { id: 8 } }, 'recording', Buffer.from('injected'))

    expect(s.write).not.toHaveBeenCalled()
  })
})

describe('piped ffmpeg sessions', () => {
  it('are marked as piped', () => {
    expect(ff.spawnFfmpeg(['-i', 'pipe:0'], { piped: true }).piped).toBe(true)
    expect(ff.spawnFfmpeg(['-i', 'x']).piped).toBeUndefined()
  })

  // Writing to a pipe whose reader has died raises 'error' on stdin; with no
  // listener that is an uncaught exception that takes the application down.
  it('survive a write to a process that has died', () => {
    const session = ff.spawnFfmpeg(['-i', 'pipe:0'], { piped: true })

    expect(() => session.child.stdin.emit('error', new Error('write EPIPE'))).not.toThrow()
    expect(session.stderr.join('\n')).toContain('EPIPE')
  })

  it('are not stopped by typing q, which would be read as data', () => {
    const session = ff.spawnFfmpeg(['-i', 'pipe:0'], { piped: true })
    ff.stopGracefully(session, 100)

    expect(session.child.stdin.write).not.toHaveBeenCalled()
    expect(session.child.stdin.end).toHaveBeenCalled()
  })

  it('other sessions are still stopped with q', () => {
    const session = ff.spawnFfmpeg(['-i', 'x'])
    ff.stopGracefully(session, 100)

    expect(session.child.stdin.write).toHaveBeenCalledWith('q')
  })
})

describe('finishPiped', () => {
  beforeEach(() => vi.useFakeTimers())

  it('closes the input and resolves when ffmpeg finishes', async () => {
    const session = ff.spawnFfmpeg(['-i', 'pipe:0'], { piped: true })

    const done = ff.finishPiped(session)
    await vi.advanceTimersByTimeAsync(0)

    expect(session.child.stdin.end).toHaveBeenCalled()
    await expect(done).resolves.toBe(true)
  })

  it('resolves at once if ffmpeg has already exited', async () => {
    const session = ff.spawnFfmpeg(['-i', 'pipe:0'], { piped: true })
    session.child.exit(0)

    await expect(ff.finishPiped(session)).resolves.toBe(true)
  })

  it('kills ffmpeg if it will not finish, and says so', async () => {
    const session = ff.spawnFfmpeg(['-i', 'pipe:0'], { piped: true })
    cp.spawned[0].exitsWhenInputCloses = false

    const done = ff.finishPiped(session, 1000)
    await vi.advanceTimersByTimeAsync(1001)

    expect(session.child.kill).toHaveBeenCalledWith('SIGKILL')
    await expect(done).resolves.toBe(false)
  })

  it('does not kill an ffmpeg that finishes in time', async () => {
    const session = ff.spawnFfmpeg(['-i', 'pipe:0'], { piped: true })
    const done = ff.finishPiped(session, 1000)
    await vi.advanceTimersByTimeAsync(2000)

    expect(session.child.kill).not.toHaveBeenCalled()
    await done
  })

  it('copes with an input that is already closed', async () => {
    const session = ff.spawnFfmpeg(['-i', 'pipe:0'], { piped: true })
    session.child.stdin.end.mockImplementationOnce(() => { throw new Error('write after end') })

    const done = ff.finishPiped(session, 500)
    await vi.advanceTimersByTimeAsync(600)

    await expect(done).resolves.toBe(false)
  })
})
