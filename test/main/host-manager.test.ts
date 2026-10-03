import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { HostManager, HostError, type HostWindowLike } from '../../electron/main/host/manager'
import { HOST_CHANNELS, EMPTY_SNAPSHOT, type HostSnapshot, type HostRequest } from '../../shared/host'

/**
 * The host window does the composing, mixing and encoding, so the main process
 * must be able to start it, ask it things, and notice when it goes away.
 */

class FakeWindow implements HostWindowLike {
  static nextId = 100
  readonly id = FakeWindow.nextId++
  destroyed = false
  sent: { channel: string; args: unknown[] }[] = []
  private closedHandlers: (() => void)[] = []

  isDestroyed() { return this.destroyed }
  send(channel: string, ...args: unknown[]) { this.sent.push({ channel, args }) }
  destroy() { this.destroyed = true; this.close() }
  onClosed(cb: () => void) { this.closedHandlers.push(cb) }
  close() { this.destroyed = true; this.closedHandlers.forEach((h) => h()) }

  requests(): HostRequest[] {
    return this.sent.filter((m) => m.channel === HOST_CHANNELS.request).map((m) => m.args[0] as HostRequest)
  }
  states(): HostSnapshot[] {
    return this.sent.filter((m) => m.channel === HOST_CHANNELS.state).map((m) => m.args[0] as HostSnapshot)
  }
}

let windows: FakeWindow[]
let manager: HostManager
const TIMEOUTS = { readyMs: 1000, requestMs: 500 }

const latest = () => windows[windows.length - 1]

/** Starts the host and marks it ready. */
async function startReady() {
  const ready = manager.ensure()
  manager.handleReady(latest().id)
  await ready
}

beforeEach(() => {
  vi.useFakeTimers()
  windows = []
  manager = new HostManager(() => {
    const w = new FakeWindow()
    windows.push(w)
    return w
  }, TIMEOUTS)
})

afterEach(() => vi.useRealTimers())

describe('starting', () => {
  it('creates the window only once', async () => {
    const first = manager.ensure()
    const second = manager.ensure()
    manager.handleReady(latest().id)
    await Promise.all([first, second])

    expect(windows).toHaveLength(1)
  })

  it('is not ready until the page says so', async () => {
    let done = false
    void manager.ensure().then(() => { done = true })

    await vi.advanceTimersByTimeAsync(200)
    expect(done).toBe(false)

    manager.handleReady(latest().id)
    await vi.advanceTimersByTimeAsync(0)
    expect(done).toBe(true)
  })

  it('gives up if the page never loads, and starts clean next time', async () => {
    const attempt = manager.ensure()
    const failure = expect(attempt).rejects.toThrow('did not start')

    await vi.advanceTimersByTimeAsync(TIMEOUTS.readyMs + 1)
    await failure

    void manager.ensure()
    expect(windows).toHaveLength(2)
  })

  it('ignores a ready message from some other window', async () => {
    let done = false
    void manager.ensure().then(() => { done = true })

    manager.handleReady(latest().id + 999)
    await vi.advanceTimersByTimeAsync(0)

    expect(done).toBe(false)
  })

  it('fails if the window is closed before it is ready', async () => {
    const attempt = manager.ensure()
    const failure = expect(attempt).rejects.toThrow('closed before it was ready')

    latest().close()
    await failure
  })

  it('starts a new window after the old one closed', async () => {
    await startReady()
    latest().close()

    void manager.ensure()
    expect(windows).toHaveLength(2)
  })
})

describe('requests', () => {
  it('sends a numbered request and resolves with the reply', async () => {
    await startReady()

    const reply = manager.request('openSession', { kind: 'recording' })
    const [sent] = latest().requests()
    expect(sent.method).toBe('openSession')
    expect(sent.args).toEqual({ kind: 'recording' })

    manager.handleResponse(latest().id, { id: sent.id, ok: true, result: 'opened' })
    await expect(reply).resolves.toBe('opened')
  })

  it('waits for the host to be ready before sending', async () => {
    const reply = manager.request('ping', {})
    await vi.advanceTimersByTimeAsync(0)
    expect(latest().requests()).toHaveLength(0)

    manager.handleReady(latest().id)
    await vi.advanceTimersByTimeAsync(0)
    expect(latest().requests()).toHaveLength(1)

    const [sent] = latest().requests()
    manager.handleResponse(latest().id, { id: sent.id, ok: true, result: 1 })
    await expect(reply).resolves.toBe(1)
  })

  it('rejects with the host\'s message when it reports an error', async () => {
    await startReady()

    const reply = manager.request('openSession', {})
    const failure = expect(reply).rejects.toThrow('encoder not supported')
    manager.handleResponse(latest().id, { id: latest().requests()[0].id, ok: false, error: 'encoder not supported' })

    await failure
  })

  it('keeps concurrent requests apart', async () => {
    await startReady()

    const a = manager.request('openSession', 'a')
    const b = manager.request('openSession', 'b')
    const [first, second] = latest().requests()
    expect(first.id).not.toBe(second.id)

    manager.handleResponse(latest().id, { id: second.id, ok: true, result: 'B' })
    manager.handleResponse(latest().id, { id: first.id, ok: true, result: 'A' })

    await expect(a).resolves.toBe('A')
    await expect(b).resolves.toBe('B')
  })

  it('times out when the host does not answer', async () => {
    await startReady()

    const reply = manager.request('openSession', {})
    const failure = expect(reply).rejects.toThrow('did not answer')
    await vi.advanceTimersByTimeAsync(TIMEOUTS.requestMs + 1)

    await failure
  })

  it('ignores a reply that arrives after the timeout', async () => {
    await startReady()
    const reply = manager.request('openSession', {})
    const failure = expect(reply).rejects.toThrow()
    const id = latest().requests()[0].id
    await vi.advanceTimersByTimeAsync(TIMEOUTS.requestMs + 1)
    await failure

    expect(() => manager.handleResponse(latest().id, { id, ok: true })).not.toThrow()
  })

  it('ignores a reply from some other window', async () => {
    await startReady()
    const reply = manager.request('openSession', {})
    let settled = false
    reply.then(() => { settled = true }, () => { settled = true })

    manager.handleResponse(latest().id + 999, { id: latest().requests()[0].id, ok: true })
    await vi.advanceTimersByTimeAsync(0)

    expect(settled).toBe(false)
    manager.handleResponse(latest().id, { id: latest().requests()[0].id, ok: true })
    await reply
  })

  it('fails everything waiting if the host goes away', async () => {
    await startReady()
    const a = manager.request('openSession', 1)
    const b = manager.request('closeSession', 2)
    const failures = Promise.all([
      expect(a).rejects.toBeInstanceOf(HostError),
      expect(b).rejects.toThrow('closed unexpectedly'),
    ])

    latest().close()

    await failures
  })
})

describe('keeping the host up to date', () => {
  const snapshot: HostSnapshot = {
    base: { width: 1280, height: 720 },
    sources: [],
    audio: [{ id: 'mic', volume: 0.5, muted: false, noiseSuppression: false, connected: true }],
  }

  it('sends the latest state as soon as the host is ready', async () => {
    manager.setSnapshot(snapshot)
    await startReady()

    expect(latest().states()).toEqual([snapshot])
  })

  it('sends the empty state if nothing was ever published', async () => {
    await startReady()
    expect(latest().states()).toEqual([EMPTY_SNAPSHOT])
  })

  it('passes on changes once the host is ready', async () => {
    await startReady()
    manager.setSnapshot(snapshot)

    expect(latest().states().at(-1)).toEqual(snapshot)
  })

  it('does not send to a host that is not ready yet', () => {
    void manager.ensure()
    manager.setSnapshot(snapshot)

    expect(latest().states()).toEqual([])
  })

  it('does nothing when there is no host', () => {
    expect(() => manager.setSnapshot(snapshot)).not.toThrow()
  })
})

describe('shutting down', () => {
  it('destroys the window', async () => {
    await startReady()
    const w = latest()

    manager.shutdown()

    expect(w.destroyed).toBe(true)
    expect(manager.running).toBe(false)
  })

  it('is harmless when nothing is running', () => {
    expect(() => manager.shutdown()).not.toThrow()
  })

  it('knows its own sender and no other', async () => {
    await startReady()
    expect(manager.isHostSender(latest().id)).toBe(true)
    expect(manager.isHostSender(latest().id + 1)).toBe(false)
  })
})
