import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * Every renderer request crosses this boundary. Two behaviours matter beyond
 * dispatch: an unknown command must not resolve silently, and a thrown Error
 * must reach the renderer as a bare message. Electron wraps a thrown Error
 * with "Error invoking remote method '...'", which would surface verbatim in
 * the interface, since the frontend's IpcError passes the string through.
 */

// The module keeps a registry in module scope, so each test needs a fresh copy.
async function freshIpc() {
  vi.resetModules()
  return import('../../electron/main/ipc')
}

let ipc: Awaited<ReturnType<typeof freshIpc>>

beforeEach(async () => {
  ipc = await freshIpc()
})

/** Runs a command the way installDispatcher's handler would. */
async function invoke(name: string, args: Record<string, unknown> = {}) {
  const { ipcMain } = await import('electron')
  ipc.installDispatcher()

  const handler = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[1]
  if (!handler) throw new Error('dispatcher was not installed')
  return handler({}, name, args)
}

describe('command registry', () => {
  it('registers a command under its name', () => {
    ipc.command('do_thing', () => 'done')
    expect(ipc.registeredCommands()).toContain('do_thing')
  })

  it('rejects a duplicate name rather than shadowing the first', () => {
    ipc.command('dupe', () => 1)
    expect(() => ipc.command('dupe', () => 2)).toThrow(/already registered/i)
  })

  it('lists commands sorted, so the startup count is stable', () => {
    ipc.command('zeta', () => 0)
    ipc.command('alpha', () => 0)
    expect(ipc.registeredCommands()).toEqual(['alpha', 'zeta'])
  })
})

describe('dispatch', () => {
  it('returns a synchronous handler result', async () => {
    ipc.command('sync_cmd', () => 42)
    await expect(invoke('sync_cmd')).resolves.toBe(42)
  })

  it('awaits an asynchronous handler', async () => {
    ipc.command('async_cmd', async () => 'later')
    await expect(invoke('async_cmd')).resolves.toBe('later')
  })

  it('passes arguments through to the handler', async () => {
    const spy = vi.fn(() => null)
    ipc.command('with_args', spy)
    await invoke('with_args', { id: 'abc', count: 3 })
    expect(spy).toHaveBeenCalledWith({ id: 'abc', count: 3 })
  })

  it('substitutes an empty object when arguments are omitted', async () => {
    const spy = vi.fn(() => null)
    ipc.command('no_args', spy)
    await invoke('no_args', undefined as never)
    expect(spy).toHaveBeenCalledWith({})
  })

  it('rejects an unknown command instead of resolving undefined', async () => {
    await expect(invoke('never_registered')).rejects.toMatch(/Unknown command/)
  })

  it('names the command that was not found', async () => {
    await expect(invoke('ghost_cmd')).rejects.toMatch(/ghost_cmd/)
  })
})

describe('error translation', () => {
  it('rethrows a thrown Error as its bare message', async () => {
    ipc.command('boom', () => {
      throw new Error('ffmpeg not found in PATH')
    })
    // A string, not an Error — Electron would otherwise prefix the renderer's
    // copy with "Error invoking remote method".
    await expect(invoke('boom')).rejects.toBe('ffmpeg not found in PATH')
  })

  it('passes a thrown string through unchanged', async () => {
    ipc.command('throw_string', () => {
      throw 'plain failure'
    })
    await expect(invoke('throw_string')).rejects.toBe('plain failure')
  })

  it('translates a rejected promise the same way', async () => {
    ipc.command('async_boom', async () => {
      throw new Error('Recording is already active')
    })
    await expect(invoke('async_boom')).rejects.toBe('Recording is already active')
  })

  it('stringifies a non-Error rejection value', async () => {
    ipc.command('weird', () => {
      throw { code: 500 }
    })
    await expect(invoke('weird')).rejects.toBe('[object Object]')
  })
})

describe('emit', () => {
  it('does not throw when no window is open', async () => {
    const { BrowserWindow } = await import('electron')
    ;(BrowserWindow.getAllWindows as ReturnType<typeof vi.fn>).mockReturnValue([])
    expect(() => ipc.emit('output:recording-status', { active: true })).not.toThrow()
  })

  it('sends the event name and payload to every live window', async () => {
    const { BrowserWindow } = await import('electron')
    const send = vi.fn()
    ;(BrowserWindow.getAllWindows as ReturnType<typeof vi.fn>).mockReturnValue([
      { isDestroyed: () => false, webContents: { send } },
      { isDestroyed: () => false, webContents: { send } },
    ])

    ipc.emit('stats:update', { cpuPercent: 12 })

    expect(send).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenCalledWith('cb:event', 'stats:update', { cpuPercent: 12 })
  })

  it('skips a destroyed window', async () => {
    const { BrowserWindow } = await import('electron')
    const send = vi.fn()
    ;(BrowserWindow.getAllWindows as ReturnType<typeof vi.fn>).mockReturnValue([
      { isDestroyed: () => true, webContents: { send } },
    ])

    ipc.emit('audio:levels', [])

    expect(send).not.toHaveBeenCalled()
  })
})
