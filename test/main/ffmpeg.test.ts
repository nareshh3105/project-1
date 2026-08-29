import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as cp from '../mocks/child-process'

vi.mock('node:child_process', () => ({
  spawn: cp.spawn,
  spawnSync: cp.spawnSync,
}))

type FfmpegModule = typeof import('../../electron/main/output/ffmpeg')
let ff: FfmpegModule

beforeEach(async () => {
  vi.resetModules()
  cp.resetChildProcessMocks()
  // ffmpegAvailable memoises its answer, so the module has to be fresh.
  ff = await import('../../electron/main/output/ffmpeg')
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ffmpegAvailable', () => {
  it('reports true when ffmpeg -version succeeds', () => {
    cp.spawnSyncResult.status = 0
    expect(ff.ffmpegAvailable()).toBe(true)
  })

  it('reports false on a non-zero exit', () => {
    cp.spawnSyncResult.status = 1
    expect(ff.ffmpegAvailable()).toBe(false)
  })

  it('reports false when the binary is missing entirely', () => {
    cp.spawnSync.mockImplementationOnce(() => {
      throw new Error('ENOENT')
    })
    expect(ff.ffmpegAvailable()).toBe(false)
  })

  it('caches the answer rather than probing on every call', () => {
    ff.ffmpegAvailable()
    ff.ffmpegAvailable()
    ff.ffmpegAvailable()
    expect(cp.spawnSync).toHaveBeenCalledTimes(1)
  })

  it('probes again when asked to recheck', () => {
    ff.ffmpegAvailable()
    ff.ffmpegAvailable(true)
    expect(cp.spawnSync).toHaveBeenCalledTimes(2)
  })

  it('picks up ffmpeg being installed after a failed first check', () => {
    cp.spawnSyncResult.status = 1
    expect(ff.ffmpegAvailable()).toBe(false)

    cp.spawnSyncResult.status = 0
    expect(ff.ffmpegAvailable(true)).toBe(true)
  })
})

describe('requireFfmpeg', () => {
  it('passes when ffmpeg is present', () => {
    cp.spawnSyncResult.status = 0
    expect(() => ff.requireFfmpeg()).not.toThrow()
  })

  it('throws an actionable message when it is not', () => {
    cp.spawnSyncResult.status = 1
    expect(() => ff.requireFfmpeg()).toThrow(/ffmpeg not found in PATH/)
  })

  it('names where to get it', () => {
    cp.spawnSyncResult.status = 1
    expect(() => ff.requireFfmpeg()).toThrow(/ffmpeg\.org/)
  })
})

describe('spawnFfmpeg', () => {
  it('invokes ffmpeg with the given arguments', () => {
    ff.spawnFfmpeg(['-i', 'desktop', 'out.mkv'])
    expect(cp.spawnCalls[0].command).toBe('ffmpeg')
    expect(cp.spawnCalls[0].args).toEqual(['-i', 'desktop', 'out.mkv'])
  })

  it('collects stderr lines', () => {
    const session = ff.spawnFfmpeg([])
    cp.spawned[0].emitStderr('frame= 100 fps=30\nframe= 200 fps=30\n')
    expect(session.stderr).toEqual(['frame= 100 fps=30', 'frame= 200 fps=30'])
  })

  it('ignores blank lines', () => {
    const session = ff.spawnFfmpeg([])
    cp.spawned[0].emitStderr('real line\n\n   \n')
    expect(session.stderr).toEqual(['real line'])
  })

  // A long encode emits thousands of progress lines; keeping them all would
  // grow without bound for the lifetime of the recording.
  it('keeps only the tail, not the whole log', () => {
    const session = ff.spawnFfmpeg([])
    for (let i = 0; i < 100; i++) cp.spawned[0].emitStderr(`line ${i}\n`)

    expect(session.stderr.length).toBeLessThanOrEqual(40)
    expect(session.stderr.at(-1)).toBe('line 99')
    expect(session.stderr).not.toContain('line 0')
  })

  it('handles chunks split mid-stream', () => {
    const session = ff.spawnFfmpeg([])
    cp.spawned[0].emitStderr('first\n')
    cp.spawned[0].emitStderr('second\n')
    expect(session.stderr).toEqual(['first', 'second'])
  })
})

describe('assertStartedOk', () => {
  it('resolves when the process is still alive after the grace window', async () => {
    vi.useFakeTimers()
    const session = ff.spawnFfmpeg([])

    const promise = ff.assertStartedOk(session, 500)
    vi.advanceTimersByTime(500)

    await expect(promise).resolves.toBeUndefined()
  })

  // Without this, a bad device name or unwritable path leaves the interface
  // showing an active recording that never produced a file.
  it('rejects when ffmpeg exits during startup', async () => {
    const session = ff.spawnFfmpeg([])
    const promise = ff.assertStartedOk(session, 5000)

    cp.spawned[0].exit(1)

    await expect(promise).rejects.toThrow(/exited immediately/)
  })

  it('includes the exit code', async () => {
    const session = ff.spawnFfmpeg([])
    const promise = ff.assertStartedOk(session, 5000)
    cp.spawned[0].exit(234)

    await expect(promise).rejects.toThrow(/code 234/)
  })

  it('includes recent stderr so the failure can be diagnosed', async () => {
    const session = ff.spawnFfmpeg([])
    const promise = ff.assertStartedOk(session, 5000)

    cp.spawned[0].emitStderr('Unknown input format: dshow\n')
    cp.spawned[0].exit(1)

    await expect(promise).rejects.toThrow(/Unknown input format: dshow/)
  })

  it('does not reject for an exit after the window has passed', async () => {
    vi.useFakeTimers()
    const session = ff.spawnFfmpeg([])

    const promise = ff.assertStartedOk(session, 300)
    vi.advanceTimersByTime(300)
    await promise

    // A later exit is a normal stop, not a startup failure.
    expect(() => cp.spawned[0].exit(0)).not.toThrow()
  })
})

describe('stopGracefully', () => {
  it('asks ffmpeg to finish rather than killing it outright', () => {
    const session = ff.spawnFfmpeg([])
    ff.stopGracefully(session)

    // "q" is ffmpeg's quit command; killing skips writing the container index
    // and can leave an unplayable file.
    expect(session.child.stdin.write).toHaveBeenCalledWith('q')
    expect(session.child.stdin.end).toHaveBeenCalled()
    expect(session.child.kill).not.toHaveBeenCalled()
  })

  it('forces the process if it has not exited within the grace period', () => {
    vi.useFakeTimers()
    const session = ff.spawnFfmpeg([])

    ff.stopGracefully(session, 2000)
    vi.advanceTimersByTime(2000)

    expect(session.child.kill).toHaveBeenCalledWith('SIGKILL')
  })

  it('does not force a process that exited on its own', () => {
    vi.useFakeTimers()
    const session = ff.spawnFfmpeg([])

    ff.stopGracefully(session, 2000)
    cp.spawned[0].exit(0)
    vi.advanceTimersByTime(5000)

    expect(session.child.kill).not.toHaveBeenCalled()
  })

  it('survives stdin already being closed', () => {
    const session = ff.spawnFfmpeg([])
    session.child.stdin.write.mockImplementation(() => {
      throw new Error('EPIPE')
    })

    expect(() => ff.stopGracefully(session)).not.toThrow()
  })
})

describe('session registry', () => {
  it('reports nothing active initially', () => {
    expect(ff.isActive('recording')).toBe(false)
  })

  it('tracks a stored session', () => {
    ff.setSession('recording', ff.spawnFfmpeg([]))
    expect(ff.isActive('recording')).toBe(true)
  })

  it('keeps kinds independent', () => {
    ff.setSession('recording', ff.spawnFfmpeg([]))
    expect(ff.isActive('streaming')).toBe(false)
  })

  it('returns and clears on take', () => {
    ff.setSession('replay', ff.spawnFfmpeg([]))

    expect(ff.takeSession('replay')).toBeDefined()
    expect(ff.isActive('replay')).toBe(false)
  })

  it('returns undefined when taking an absent session', () => {
    expect(ff.takeSession('virtualCamera')).toBeUndefined()
  })

  it('preserves extra fields stored alongside the process', () => {
    ff.setSession('replay', { ...ff.spawnFfmpeg([]), segmentDir: '/tmp/x', bufferSecs: 30 })
    const session = ff.getSession('replay')

    expect(session?.segmentDir).toBe('/tmp/x')
    expect(session?.bufferSecs).toBe(30)
  })
})

describe('killAllSessions', () => {
  it('stops every active session', () => {
    ff.setSession('recording', ff.spawnFfmpeg([]))
    ff.setSession('streaming', ff.spawnFfmpeg([]))

    ff.killAllSessions()

    expect(ff.isActive('recording')).toBe(false)
    expect(ff.isActive('streaming')).toBe(false)
  })

  it('asks each process to finish', () => {
    const a = ff.spawnFfmpeg([])
    ff.setSession('recording', a)

    ff.killAllSessions()

    expect(a.child.stdin.write).toHaveBeenCalledWith('q')
  })

  it('is safe with nothing running', () => {
    expect(() => ff.killAllSessions()).not.toThrow()
  })
})

describe('paths', () => {
  it('formats a filesystem-safe timestamp', () => {
    expect(ff.timestamp()).toMatch(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/)
  })

  it('names recordings under the Videos folder', () => {
    const p = ff.defaultRecordingPath()
    expect(p).toContain('Videos')
    expect(p).toMatch(/CodeBuilders_.*\.mkv$/)
  })

})

describe('uniquePath (FR-5.7)', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-unique-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('returns the path unchanged when nothing is there', () => {
    const file = path.join(dir, 'Recording.mkv')
    expect(ff.uniquePath(file)).toBe(file)
  })

  // Timestamps resolve to the second and ffmpeg runs with -y, so without this
  // a second output in the same second silently overwrites the first.
  it('numbers a name that already exists', () => {
    const file = path.join(dir, 'Recording.mkv')
    fs.writeFileSync(file, '')

    expect(ff.uniquePath(file)).toBe(path.join(dir, 'Recording_2.mkv'))
  })

  it('keeps counting past the first collision', () => {
    const file = path.join(dir, 'Recording.mkv')
    fs.writeFileSync(file, '')
    fs.writeFileSync(path.join(dir, 'Recording_2.mkv'), '')

    expect(ff.uniquePath(file)).toBe(path.join(dir, 'Recording_3.mkv'))
  })

  it('keeps the extension intact', () => {
    const file = path.join(dir, 'Screenshot_2026-01-01_12-00-00.png')
    fs.writeFileSync(file, '')

    expect(ff.uniquePath(file)).toMatch(/\.png$/)
  })

  it('never returns a path that already exists', () => {
    const file = path.join(dir, 'Recording.mkv')

    // Simulate three outputs produced inside the same second.
    for (let i = 0; i < 3; i++) {
      const next = ff.uniquePath(file)
      expect(fs.existsSync(next)).toBe(false)
      fs.writeFileSync(next, '')
    }

    expect(fs.readdirSync(dir)).toHaveLength(3)
  })
})
