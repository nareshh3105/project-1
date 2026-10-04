import { describe, it, expect, beforeEach } from 'vitest'
import { OutputHealth, STRUGGLE_RATIO, type HealthSample } from '../../electron/main/output/health'

/**
 * The status bar used to say 30 fps and no dropped frames whatever happened.
 * These readings are the measured truth, and the call that a computer is not
 * keeping up must not flap on one bad second.
 */

let health: OutputHealth
let t: number
let framesIn: number
let dropped: number
let bytes: number

/** A reading `seconds` after the last, with this much happening in between. */
function tick(seconds: number, arrived: number, lost = 0, produced = 0): HealthSample {
  t += seconds * 1000
  framesIn += arrived
  dropped += lost
  bytes += produced
  return { at: t, framesIn, framesDropped: dropped, bytesOut: bytes }
}

beforeEach(() => {
  health = new OutputHealth()
  t = 1_000_000; framesIn = 0; dropped = 0; bytes = 0
  health.record('recording', { at: t, framesIn: 0, framesDropped: 0, bytesOut: 0 })
})

const rec = () => health.metrics().find((m) => m.kind === 'recording')!

describe('measuring', () => {
  it('reports the frames per second that reached the encoder', () => {
    health.record('recording', tick(2, 60))
    expect(rec().fps).toBe(30)
  })

  it('does not count dropped frames as delivered', () => {
    health.record('recording', tick(2, 120, 60))
    expect(rec().fps).toBe(30)
  })

  it('reports the bitrate in bits per second', () => {
    health.record('recording', tick(2, 60, 0, 500_000))
    expect(rec().bitrateBps).toBe(2_000_000)
  })

  it('counts dropped frames since the output began', () => {
    health.record('recording', tick(2, 60, 4))
    health.record('recording', tick(2, 60, 3))
    expect(rec().framesDropped).toBe(7)
  })

  it('reports the share of the latest interval dropped', () => {
    health.record('recording', tick(2, 100, 10))
    expect(rec().recentDropRatio).toBeCloseTo(0.1)
  })

  it('has nothing to report before it has two readings', () => {
    expect(rec().fps).toBe(0)
  })

  it('ignores a reading that repeats or goes back in time', () => {
    const first = tick(2, 60)
    health.record('recording', first)
    health.record('recording', first)
    health.record('recording', { ...first, at: first.at - 500 })
    expect(rec().fps).toBe(30)
  })

  it('never reports a negative rate if the host restarted its counts', () => {
    health.record('recording', tick(2, 60))
    health.record('recording', { at: t + 2000, framesIn: 0, framesDropped: 0, bytesOut: 0 })
    expect(rec().fps).toBeGreaterThanOrEqual(0)
    expect(rec().bitrateBps).toBeGreaterThanOrEqual(0)
  })
})

describe('deciding it is not keeping up', () => {
  const bad = () => health.record('recording', tick(2, 100, Math.ceil(100 * (STRUGGLE_RATIO + 0.05))))
  const good = () => health.record('recording', tick(2, 100, 0))

  it('does not on one bad reading', () => {
    expect(bad()).toBeNull()
    expect(rec().struggling).toBe(false)
  })

  it('does after two in a row, and says so once', () => {
    bad()
    expect(bad()).toBe(true)
    expect(rec().struggling).toBe(true)
    expect(bad()).toBeNull() // already said
  })

  it('does not on isolated bad readings between good ones', () => {
    bad(); good(); bad(); good(); bad(); good()
    expect(rec().struggling).toBe(false)
  })

  it('tolerates a small number of dropped frames', () => {
    for (let i = 0; i < 10; i++) health.record('recording', tick(2, 100, 2))
    expect(rec().struggling).toBe(false)
  })

  it('calls it off only after several good readings, so it does not flap', () => {
    bad(); bad()
    expect(good()).toBeNull()
    expect(good()).toBeNull()
    expect(good()).toBe(false)
    expect(rec().struggling).toBe(false)
  })

  it('a bad reading restarts the count of good ones', () => {
    bad(); bad()
    good(); good(); bad(); good(); good()
    expect(rec().struggling).toBe(true)
  })

  it('does not count a quiet interval with no frames at all as bad', () => {
    for (let i = 0; i < 5; i++) health.record('recording', tick(2, 0, 0))
    expect(rec().struggling).toBe(false)
  })

  it('judges each output on its own', () => {
    health.record('streaming', { at: t, framesIn: 0, framesDropped: 0, bytesOut: 0 })
    bad(); bad()
    expect(health.metrics().find((m) => m.kind === 'streaming')!.struggling).toBe(false)
  })
})

describe('ending an output', () => {
  it('forgets it, so the next one starts clean', () => {
    health.record('recording', tick(2, 100, 50))
    health.record('recording', tick(2, 100, 50))
    health.reset('recording')
    expect(health.metrics()).toEqual([])

    health.record('recording', { at: t + 1, framesIn: 0, framesDropped: 0, bytesOut: 0 })
    expect(rec().struggling).toBe(false)
  })

  it('is harmless for something that never ran', () => {
    expect(() => health.reset('replay')).not.toThrow()
  })
})

describe('the summary for the status bar', () => {
  it('says nothing is running when nothing is', () => {
    expect(new OutputHealth().summary()).toEqual({ fps: 0, bitrateBps: 0, framesDropped: 0, active: false })
  })

  it('leads with the recording', () => {
    health.record('streaming', { at: t, framesIn: 0, framesDropped: 0, bytesOut: 0 })
    health.record('recording', tick(2, 40))
    health.record('streaming', { at: t, framesIn: 120, framesDropped: 0, bytesOut: 0 })
    expect(health.summary().fps).toBe(20)
  })

  it('adds up bitrate and dropped frames across outputs', () => {
    health.record('streaming', { at: t, framesIn: 0, framesDropped: 0, bytesOut: 0 })
    health.record('recording', tick(2, 60, 3, 250_000))
    health.record('streaming', { at: t, framesIn: 60, framesDropped: 5, bytesOut: 250_000 })
    const s = health.summary()
    expect(s.framesDropped).toBe(8)
    expect(s.bitrateBps).toBe(1_000_000 + 1_000_000)
    expect(s.active).toBe(true)
  })
})
