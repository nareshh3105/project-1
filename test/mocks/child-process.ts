import { EventEmitter } from 'node:events'
import { vi } from 'vitest'

/**
 * Stand-in for a spawned ffmpeg process.
 *
 * Only the surface the output layer touches is implemented: a writable stdin
 * (the graceful stop writes "q" to it), a stderr stream that emits string
 * chunks, kill(), and exit events.
 */
export class FakeChild extends EventEmitter {
  stdin = {
    write: vi.fn(),
    end: vi.fn(),
  }

  stderr = Object.assign(new EventEmitter(), {
    setEncoding: vi.fn(),
  })

  kill = vi.fn((signal?: string) => {
    this.exitCode = signal === 'SIGKILL' ? 137 : 0
    this.emit('exit', this.exitCode)
    return true
  })

  exitCode: number | null = null

  /** Emit a chunk on stderr, as ffmpeg would while encoding. */
  emitStderr(text: string) {
    this.stderr.emit('data', text)
  }

  /** Simulate the process ending on its own. */
  exit(code: number) {
    this.exitCode = code
    this.emit('exit', code)
  }
}

export const spawned: FakeChild[] = []

/** Arguments passed to each spawn call, in order. */
export const spawnCalls: { command: string; args: string[] }[] = []

export const spawn = vi.fn((command: string, args: string[]) => {
  spawnCalls.push({ command, args })
  const child = new FakeChild()
  spawned.push(child)
  return child
})

/** Controls what the next spawnSync call returns. */
export const spawnSyncResult = {
  status: 0 as number | null,
  stdout: '',
  stderr: '',
}

export const spawnSync = vi.fn(() => ({ ...spawnSyncResult }))

export function resetChildProcessMocks() {
  spawned.length = 0
  spawnCalls.length = 0
  spawnSyncResult.status = 0
  spawnSyncResult.stdout = ''
  spawnSyncResult.stderr = ''
  spawn.mockClear()
  spawnSync.mockClear()
}

/** The most recent spawn's argument list. */
export const lastArgs = () => spawnCalls.at(-1)?.args ?? []

/** The value following `flag` in the most recent spawn's arguments. */
export const argAfter = (flag: string) => {
  const args = lastArgs()
  const i = args.indexOf(flag)
  return i === -1 ? undefined : args[i + 1]
}
