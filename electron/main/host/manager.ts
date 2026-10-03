import {
  HOST_CHANNELS, EMPTY_SNAPSHOT,
  type HostMethod, type HostRequest, type HostResponse, type HostSnapshot,
} from '../../../shared/host'

/**
 * The main process's handle on the output host window.
 *
 * The host does the work of composing, mixing and encoding; this class creates
 * it, waits until its page can take requests, and carries requests and replies
 * to and from it. Written against a small window interface so it can be tested
 * without Electron.
 */

export interface HostWindowLike {
  /** webContents id; messages are only accepted from this sender. */
  readonly id: number
  isDestroyed(): boolean
  send(channel: string, ...args: unknown[]): void
  destroy(): void
  onClosed(callback: () => void): void
}

/** A failure of the host itself, as opposed to an error the host reports. */
export class HostError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HostError'
  }
}

export interface HostTimeouts {
  /** How long to wait for the page to load and say it is ready. */
  readyMs: number
  /** How long a single request may take. Opening an encoder can take a moment. */
  requestMs: number
}

const DEFAULT_TIMEOUTS: HostTimeouts = { readyMs: 15_000, requestMs: 20_000 }

interface Pending {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class HostManager {
  private window: HostWindowLike | null = null
  private ready: Promise<void> | null = null
  private isReady = false
  private settleReady: { resolve: () => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private snapshot: HostSnapshot = EMPTY_SNAPSHOT

  constructor(
    private readonly create: () => HostWindowLike,
    private readonly timeouts: HostTimeouts = DEFAULT_TIMEOUTS,
  ) {}

  /** Creates the host window if there is not one, and resolves once it is ready. */
  ensure(): Promise<void> {
    if (this.window && !this.window.isDestroyed() && this.ready) return this.ready

    const window = this.create()
    this.window = window
    this.isReady = false

    this.ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.settleReady = null
        // A host that never loaded is no use; start clean next time.
        this.discard()
        reject(new HostError('The output engine did not start.'))
      }, this.timeouts.readyMs)
      this.settleReady = { resolve, reject, timer }
    })
    // Nobody may be awaiting it yet when it fails; that must not be unhandled.
    this.ready.catch(() => {})

    window.onClosed(() => {
      if (this.window === window) this.handleClosed()
    })
    return this.ready
  }

  /** True if `senderId` is the host's own page. Everything else is ignored. */
  isHostSender(senderId: number): boolean {
    return this.window !== null && !this.window.isDestroyed() && this.window.id === senderId
  }

  /** The host page has loaded and can take requests. */
  handleReady(senderId: number): void {
    if (!this.isHostSender(senderId) || !this.settleReady) return

    clearTimeout(this.settleReady.timer)
    this.settleReady.resolve()
    this.settleReady = null
    this.isReady = true

    // Bring a freshly loaded host up to date with what the interface last said.
    this.window?.send(HOST_CHANNELS.state, this.snapshot)
  }

  request<T = unknown>(method: HostMethod, args: unknown): Promise<T> {
    // A host that is already up gets the message at once; only a cold start waits.
    if (this.isReady && this.window && !this.window.isDestroyed()) {
      return this.post<T>(method, args)
    }
    return this.ensure().then(() => this.post<T>(method, args))
  }

  private post<T>(method: HostMethod, args: unknown): Promise<T> {
    const window = this.window
    if (!window || window.isDestroyed()) {
      return Promise.reject(new HostError('The output engine is not running.'))
    }

    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new HostError(`The output engine did not answer (${method}).`))
      }, this.timeouts.requestMs)

      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
      const message: HostRequest = { id, method, args }
      window.send(HOST_CHANNELS.request, message)
    })
  }

  handleResponse(senderId: number, response: HostResponse): void {
    if (!this.isHostSender(senderId)) return

    const pending = this.pending.get(response.id)
    if (!pending) return // late, or already timed out

    this.pending.delete(response.id)
    clearTimeout(pending.timer)
    if (response.ok) pending.resolve(response.result)
    else pending.reject(new HostError(response.error || 'The output engine reported an error.'))
  }

  /** Records the latest scene and mixer state and passes it on if the host is up. */
  setSnapshot(snapshot: HostSnapshot): void {
    this.snapshot = snapshot
    if (this.isReady && this.window && !this.window.isDestroyed()) {
      this.window.send(HOST_CHANNELS.state, snapshot)
    }
  }

  get running(): boolean {
    return this.window !== null && !this.window.isDestroyed()
  }

  shutdown(): void {
    const window = this.window
    this.discard()
    if (window && !window.isDestroyed()) window.destroy()
  }

  // ── internals ──

  /** Forget the window and fail everything waiting on it. */
  private discard(): void {
    this.window = null
    this.ready = null
    this.isReady = false
    if (this.settleReady) {
      clearTimeout(this.settleReady.timer)
      this.settleReady = null
    }
    this.failPending(new HostError('The output engine closed unexpectedly.'))
  }

  private handleClosed(): void {
    const wasStarting = this.settleReady
    this.discard()
    wasStarting?.reject(new HostError('The output engine closed before it was ready.'))
  }

  private failPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(error)
      this.pending.delete(id)
    }
  }
}
