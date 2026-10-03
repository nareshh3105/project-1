import { describe, it, expect, beforeEach } from 'vitest'
import { FrameLoop, type LoopDeps } from '../../src/host/frameLoop'

/**
 * A fake clock that runs timers in order, so the pacing rules (hold the rate
 * over time, skip rather than burst, one output's failure must not stop another)
 * are tested exactly rather than against real timers.
 */

class FakeClock implements LoopDeps {
  time = 0
  private timers: Array<{ at: number; cb: () => void; id: number }> = []
  private nextId = 1
  /** Extra time a timer fires late, to simulate a busy thread. */
  lateBy = (_n: number) => 0
  fired = 0

  now = () => this.time
  setTimer = (cb: () => void, ms: number) => {
    const id = this.nextId++
    this.timers.push({ at: this.time + ms, cb, id })
    return id
  }
  clearTimer = (h: unknown) => { this.timers = this.timers.filter((t) => t.id !== h) }

  /** Runs timers until the clock reaches `until`. */
  run(until: number) {
    for (;;) {
      this.timers.sort((a, b) => a.at - b.at)
      const next = this.timers[0]
      if (!next || next.at > until) break
      this.timers.shift()
      this.time = Math.max(this.time, next.at) + this.lateBy(this.fired++)
      next.cb()
    }
    this.time = Math.max(this.time, until)
  }
  get pending() { return this.timers.length }
}

let clock: FakeClock
let loop: FrameLoop
let drawn: Record<string, number[]>
const draw = (id: string) => (t: number) => { (drawn[id] ??= []).push(t) }

beforeEach(() => {
  clock = new FakeClock()
  loop = new FrameLoop(clock)
  drawn = {}
})

describe('pacing', () => {
  it('draws at the output\'s frame rate', () => {
    loop.add('rec', 30, draw('rec'))
    loop.start()
    clock.run(1000)

    expect(drawn.rec.length).toBeGreaterThanOrEqual(30)
    expect(drawn.rec.length).toBeLessThanOrEqual(31)
  })

  it('draws 60 fps outputs twice as often', () => {
    loop.add('a', 60, draw('a'))
    loop.start()
    clock.run(1000)
    expect(drawn.a.length).toBeGreaterThanOrEqual(60)
    expect(drawn.a.length).toBeLessThanOrEqual(61)
  })

  it('serves outputs of different rates from one timer', () => {
    loop.add('rec', 60, draw('rec'))
    loop.add('stream', 30, draw('stream'))
    loop.start()
    clock.run(2000)

    expect(drawn.rec.length / drawn.stream.length).toBeCloseTo(2, 0)
    expect(clock.pending).toBe(1)
  })

  // Scheduling from when a frame finished would let every late tick delay all later ones.
  it('holds the rate over time even when ticks arrive late', () => {
    clock.lateBy = (n) => (n % 3 === 0 ? 7 : 0)
    loop.add('rec', 30, draw('rec'))
    loop.start()
    clock.run(10_000)

    expect(drawn.rec.length).toBeGreaterThanOrEqual(299)
    expect(drawn.rec.length).toBeLessThanOrEqual(301)
  })

  it('skips frames after a long stall rather than drawing a burst to catch up', () => {
    loop.add('rec', 30, draw('rec'))
    loop.start()
    clock.run(100)
    const before = drawn.rec.length

    clock.time += 2000 // the thread was blocked for two seconds
    clock.run(clock.time + 100)

    // A few frames, not the sixty that were missed.
    expect(drawn.rec.length - before).toBeLessThan(8)
  })

  it('passes the time the frame was drawn at', () => {
    loop.add('rec', 30, draw('rec'))
    loop.start()
    clock.run(200)

    for (let i = 1; i < drawn.rec.length; i++) expect(drawn.rec[i]).toBeGreaterThan(drawn.rec[i - 1])
  })

  it.each([[0], [-5], [NaN]])('falls back to 30 fps for %s', (fps) => {
    loop.add('x', fps, draw('x'))
    loop.start()
    clock.run(1000)
    expect(drawn.x.length).toBeGreaterThanOrEqual(30)
    expect(drawn.x.length).toBeLessThanOrEqual(31)
  })

  it('caps absurd rates', () => {
    loop.add('x', 100_000, draw('x'))
    loop.start()
    clock.run(1000)
    expect(drawn.x.length).toBeLessThanOrEqual(241)
  })
})

describe('adding and removing', () => {
  it('does not draw before it is started', () => {
    loop.add('rec', 30, draw('rec'))
    clock.run(500)
    expect(drawn.rec).toBeUndefined()
  })

  it('picks up an output added while running', () => {
    loop.start()
    loop.add('late', 30, draw('late'))
    clock.run(500)
    expect(drawn.late.length).toBeGreaterThan(10)
  })

  it('stops drawing a removed output and leaves the others', () => {
    loop.add('a', 30, draw('a'))
    loop.add('b', 30, draw('b'))
    loop.start()
    clock.run(300)
    loop.remove('a')
    const aCount = drawn.a.length
    clock.run(900)

    expect(drawn.a.length).toBe(aCount)
    expect(drawn.b.length).toBeGreaterThan(aCount)
  })

  it('has no timer once nothing is left to draw', () => {
    loop.add('a', 30, draw('a'))
    loop.start()
    loop.remove('a')
    expect(clock.pending).toBe(0)
  })

  it('stops and can start again', () => {
    loop.add('a', 30, draw('a'))
    loop.start()
    clock.run(200)
    loop.stop()
    const n = drawn.a.length
    clock.run(1000)
    expect(drawn.a.length).toBe(n)
    expect(clock.pending).toBe(0)

    loop.start()
    clock.run(clock.time + 300)
    expect(drawn.a.length).toBeGreaterThan(n)
  })

  it('does not stack timers when started twice', () => {
    loop.add('a', 30, draw('a'))
    loop.start()
    loop.start()
    expect(clock.pending).toBe(1)
  })

  it('replaces an output of the same name', () => {
    loop.add('a', 30, draw('old'))
    loop.add('a', 30, draw('new'))
    loop.start()
    clock.run(200)

    expect(drawn.old).toBeUndefined()
    expect(drawn.new.length).toBeGreaterThan(0)
    expect(loop.size).toBe(1)
  })

  it('can remove an output from inside its own draw', () => {
    loop.add('a', 30, () => { loop.remove('a') })
    loop.start()
    expect(() => clock.run(200)).not.toThrow()
    expect(loop.size).toBe(0)
  })
})

describe('failures', () => {
  it('keeps drawing the others when one throws, and says which', () => {
    const errors: string[] = []
    loop.onError = (id) => errors.push(id)
    loop.add('bad', 30, () => { throw new Error('canvas lost') })
    loop.add('good', 30, draw('good'))
    loop.start()
    clock.run(300)

    expect(errors.length).toBeGreaterThan(0)
    expect(new Set(errors)).toEqual(new Set(['bad']))
    expect(drawn.good.length).toBeGreaterThan(5)
  })
})
