import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * The status bar's numbers. The frame rate, bitrate and dropped frames used to
 * be fixed values (30, 0, 0) whatever the outputs were doing.
 */

vi.mock('systeminformation', () => ({
  default: {
    currentLoad: async () => ({ currentLoad: 12.5 }),
    mem: async () => ({ active: 2 * 1024 * 1024 * 1024, used: 3 * 1024 * 1024 * 1024 }),
  },
}))

vi.mock('../../electron/main/host/instance', async () => {
  const { EventEmitter } = await import('node:events')
  return { getHost: () => ({ request: async () => undefined }), hostEvents: new EventEmitter() }
})

let invoke: (name: string, args?: Record<string, unknown>) => Promise<unknown>
let sent: Array<{ name: string; payload: Record<string, number> }>
let outputHealth: typeof import('../../electron/main/commands/output')['outputHealth']

beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers()
  sent = []

  const ipc = await import('../../electron/main/ipc')
  const { registerStatsCommands } = await import('../../electron/main/commands/stats')
  outputHealth = (await import('../../electron/main/commands/output')).outputHealth

  const { BrowserWindow, ipcMain } = await import('electron')
  ;(BrowserWindow.getAllWindows as ReturnType<typeof vi.fn>).mockReturnValue([{
    isDestroyed: () => false,
    webContents: { send: (_c: string, name: string, payload: Record<string, number>) => sent.push({ name, payload }) },
  }])

  registerStatsCommands()
  ipc.installDispatcher()
  const handler = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1]
  invoke = (name, args = {}) => handler({}, name, args)
})

afterEach(async () => {
  await invoke('stop_stats_polling')
  vi.useRealTimers()
})

const latest = () => sent.filter((e) => e.name === 'stats:update').at(-1)!.payload

describe('the stats the status bar shows', () => {
  it('reports the real processor and memory use', async () => {
    await invoke('start_stats_polling')
    await vi.advanceTimersByTimeAsync(10)
    expect(latest().cpuPercent).toBe(12.5)
    expect(latest().memoryMb).toBe(2048)
  })

  it('shows no frame rate, bitrate or dropped frames when nothing is running', async () => {
    await invoke('start_stats_polling')
    await vi.advanceTimersByTimeAsync(10)
    expect(latest()).toMatchObject({ renderFps: 0, encodeFps: 0, outputBitrateBps: 0, skippedFramesEncode: 0 })
  })

  it('shows what a running output is really doing', async () => {
    outputHealth.record('recording', { at: 0, framesIn: 0, framesDropped: 0, bytesOut: 0 })
    outputHealth.record('recording', { at: 2000, framesIn: 118, framesDropped: 4, bytesOut: 750_000 })

    await invoke('start_stats_polling')
    await vi.advanceTimersByTimeAsync(10)
    expect(latest().renderFps).toBe(57)
    expect(latest().outputBitrateBps).toBe(3_000_000)
    expect(latest().skippedFramesEncode).toBe(4)
  })

  it('keeps polling about every two seconds', async () => {
    await invoke('start_stats_polling')
    await vi.advanceTimersByTimeAsync(2100)
    expect(sent.filter((e) => e.name === 'stats:update').length).toBeGreaterThanOrEqual(2)
  })

  it('does not start a second poll if asked again', async () => {
    await invoke('start_stats_polling')
    await invoke('start_stats_polling')
    await vi.advanceTimersByTimeAsync(2100)
    expect(sent.filter((e) => e.name === 'stats:update').length).toBeLessThanOrEqual(3)
  })
})
