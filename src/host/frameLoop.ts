/**
 * Calls each output's draw function at its own frame rate.
 *
 * Driven by a timer rather than requestAnimationFrame, which stops when the
 * window is not on screen, and which is the display's rate rather than the
 * output's. The timer is self-correcting: each frame is scheduled from where it
 * was due, not from when the last one finished, so a late tick does not push
 * every later frame back and the rate holds over time.
 */

export interface LoopDeps {
  now(): number
  setTimer(callback: () => void, ms: number): unknown
  clearTimer(handle: unknown): void
}

interface Target {
  intervalMs: number
  dueAt: number
  draw: (nowMs: number) => void
}

/** A frame later than this many intervals is skipped, not caught up with a burst. */
const MAX_LATE_INTERVALS = 2

export class FrameLoop {
  private readonly targets = new Map<string, Target>()
  private handle: unknown = null
  private running = false

  /** Called when a draw function throws; the loop carries on for the others. */
  onError: (id: string, error: unknown) => void = () => {}

  constructor(private readonly deps: LoopDeps) {}

  add(id: string, fps: number, draw: (nowMs: number) => void): void {
    const safeFps = Number.isFinite(fps) && fps > 0 ? Math.min(fps, 240) : 30
    const intervalMs = 1000 / safeFps
    this.targets.set(id, { intervalMs, dueAt: this.deps.now(), draw })
    if (this.running) this.schedule()
  }

  remove(id: string): void {
    this.targets.delete(id)
    if (this.targets.size === 0) this.cancel()
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.schedule()
  }

  stop(): void {
    this.running = false
    this.cancel()
  }

  get size(): number {
    return this.targets.size
  }

  // ── internals ──

  private cancel(): void {
    if (this.handle !== null) this.deps.clearTimer(this.handle)
    this.handle = null
  }

  private schedule(): void {
    this.cancel()
    if (!this.running || this.targets.size === 0) return

    let earliest = Infinity
    for (const t of this.targets.values()) earliest = Math.min(earliest, t.dueAt)
    const wait = Math.max(0, earliest - this.deps.now())

    this.handle = this.deps.setTimer(() => this.tick(), wait)
  }

  private tick(): void {
    this.handle = null
    if (!this.running) return

    const now = this.deps.now()
    for (const [id, t] of [...this.targets]) {
      if (t.dueAt > now) continue

      // Next slot from this one's due time; if far behind, from now.
      t.dueAt += t.intervalMs
      if (now - t.dueAt > t.intervalMs * MAX_LATE_INTERVALS) t.dueAt = now + t.intervalMs

      try {
        t.draw(now)
      } catch (err) {
        this.onError(id, err)
      }
    }
    this.schedule()
  }
}
