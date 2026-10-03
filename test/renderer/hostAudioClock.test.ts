import { describe, it, expect } from 'vitest'
import { AudioClockMap, AudioTimeline } from '../../src/host/audioClock'

/**
 * Video is stamped from the wall clock; audio comes from the audio clock, which
 * drifts against it and shares no origin. These tests drive the two pieces that
 * reconcile them with simulated drift and delivery jitter, because a mistake
 * here is invisible in a short test and shows up as lip-sync drift after an hour.
 */

const RATE = 48000
const BLOCK_MS = (1024 / RATE) * 1000

/** A tiny deterministic noise source, so failures reproduce. */
function rng(seed = 1) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

interface Sim {
  /** Wall-clock ms = ctxMs * rate + origin, i.e. audio clock speed relative to the wall. */
  speed?: number
  originMs?: number
  /** Delivery lateness: at least `minLate`, plus up to `jitter` more. */
  minLate?: number
  jitter?: number
  seconds: number
  seed?: number
}

/** Feeds a map a stream of blocks and returns it with the true relation for checking. */
function simulate(map: AudioClockMap, { speed = 1, originMs = 5000, minLate = 3, jitter = 25, seconds, seed = 7 }: Sim) {
  const rand = rng(seed)
  const blocks = Math.floor((seconds * 1000) / BLOCK_MS)

  for (let i = 0; i < blocks; i++) {
    const ctxStartMs = i * BLOCK_MS
    const trueEndWall = originMs + (ctxStartMs + BLOCK_MS) / speed
    map.observe(ctxStartMs / 1000, BLOCK_MS, trueEndWall + minLate + rand() * jitter)
  }

  /** The true wall time of a position on the audio clock. */
  return (ctxSec: number) => originMs + (ctxSec * 1000) / speed
}

describe('AudioClockMap', () => {
  it('uses the anchor until it has seen anything', () => {
    const map = new AudioClockMap({ anchor: { ctxSec: 2, perfMs: 10_000 } })
    expect(map.toPerfMs(3)).toBe(11_000)
  })

  it('finds the offset between the clocks despite delivery jitter', () => {
    const map = new AudioClockMap({ anchor: { ctxSec: 0, perfMs: 0 } })
    const truth = simulate(map, { seconds: 20 })

    // Within the minimum delivery latency; jitter above that must not leak in.
    expect(Math.abs(map.toPerfMs(15) - truth(15))).toBeLessThan(8)
  })

  it('is not thrown off by one very late delivery', () => {
    const map = new AudioClockMap({ anchor: { ctxSec: 0, perfMs: 0 } })
    const truth = simulate(map, { seconds: 10 })
    map.observe(10.0, BLOCK_MS, truth(10) + BLOCK_MS + 900) // a 900 ms stall

    expect(Math.abs(map.toPerfMs(10) - truth(10))).toBeLessThan(8)
  })

  it.each([
    ['a clock 0.5% slow', 0.995],
    ['a clock 1.4% slow', 0.986],
    ['a clock 0.5% fast', 1.005],
    ['a real device, 50 ppm off', 1.00005],
  ])('follows %s', (_label, speed) => {
    const map = new AudioClockMap({ anchor: { ctxSec: 0, perfMs: 5000 } })
    const truth = simulate(map, { seconds: 60, speed })

    // After a minute the error must stay small even as the drift accumulates.
    expect(Math.abs(map.toPerfMs(58) - truth(58))).toBeLessThan(25)
  })

  it('does not let drift accumulate over a long session', () => {
    const map = new AudioClockMap({ anchor: { ctxSec: 0, perfMs: 5000 } })
    const truth = simulate(map, { seconds: 600, speed: 0.99 })

    // 1% over ten minutes is six seconds of drift; an uncorrected map would be that far out.
    expect(Math.abs(map.toPerfMs(595) - truth(595))).toBeLessThan(25)
  })

  it('stays put when there is no drift', () => {
    const map = new AudioClockMap({ anchor: { ctxSec: 0, perfMs: 5000 } })
    const truth = simulate(map, { seconds: 120, speed: 1 })

    const errors = [10, 40, 80, 118].map((s) => Math.abs(map.toPerfMs(s) - truth(s)))
    expect(Math.max(...errors)).toBeLessThan(10)
  })

  it('is monotonic: later audio never maps to an earlier time', () => {
    const map = new AudioClockMap({ anchor: { ctxSec: 0, perfMs: 5000 } })
    simulate(map, { seconds: 30, speed: 0.99 })

    let last = -Infinity
    for (let s = 0; s <= 30; s += 0.5) {
      const t = map.toPerfMs(s)
      expect(t).toBeGreaterThan(last)
      last = t
    }
  })

  it('copes with a start that is not at audio time zero', () => {
    const map = new AudioClockMap({ anchor: { ctxSec: 100, perfMs: 7000 } })
    const rand = rng(3)
    for (let i = 0; i < 400; i++) {
      const ctxStartMs = 100_000 + i * BLOCK_MS
      map.observe(ctxStartMs / 1000, BLOCK_MS, 7000 + (ctxStartMs - 100_000) + BLOCK_MS + 2 + rand() * 20)
    }
    const expected = 7000 + 5000
    expect(Math.abs(map.toPerfMs(105) - expected)).toBeLessThan(8)
  })
})

describe('AudioTimeline', () => {
  const frames = 1024

  it('starts the first block where the wall clock says it begins', () => {
    const t = new AudioTimeline({ sampleRate: RATE })
    const p = t.place(250, frames)

    expect(p.padFrames).toBe(0)
    expect(p.skipFrames).toBe(0)
    expect(p.timestampUs).toBe(250_000)
  })

  it('lays blocks end to end', () => {
    const t = new AudioTimeline({ sampleRate: RATE })
    const first = t.place(0, frames)
    const second = t.place(BLOCK_MS, frames)

    expect(second.timestampUs).toBe(first.timestampUs + Math.round((frames / RATE) * 1e6))
  })

  // Stamping each block from its measured time would wobble; end-to-end placement must not.
  it('ignores small wobble in the expected time', () => {
    const t = new AudioTimeline({ sampleRate: RATE })
    t.place(0, frames)
    const wobbled = t.place(BLOCK_MS + 8, frames)

    expect(wobbled.padFrames).toBe(0)
    expect(wobbled.skipFrames).toBe(0)
  })

  it('fills a gap with silence once audio falls behind past the tolerance', () => {
    const t = new AudioTimeline({ sampleRate: RATE, toleranceMs: 20 })
    t.place(0, frames)
    const late = t.place(BLOCK_MS + 100, frames)

    expect(late.padFrames).toBeGreaterThan(0)
    expect(late.skipFrames).toBe(0)
    // After the padding the block sits where the clock says it should.
    expect(late.timestampUs / 1000).toBeCloseTo(BLOCK_MS + 100, 0)
  })

  it('drops the overlap once audio runs ahead past the tolerance', () => {
    const t = new AudioTimeline({ sampleRate: RATE, toleranceMs: 20 })
    t.place(0, frames)
    const early = t.place(BLOCK_MS - 80, frames)

    expect(early.skipFrames).toBeGreaterThan(0)
    expect(early.padFrames).toBe(0)
  })

  it('never drops more than the block holds', () => {
    const t = new AudioTimeline({ sampleRate: RATE, toleranceMs: 20 })
    t.place(5000, frames)
    const wayEarly = t.place(0, frames)

    expect(wayEarly.skipFrames).toBe(frames)
  })

  it('stays within the tolerance of the wall clock through a long drift', () => {
    const t = new AudioTimeline({ sampleRate: RATE, toleranceMs: 20 })
    // Wall time runs 1% faster than the audio supplies samples.
    let worst = 0
    for (let i = 0; i < 20_000; i++) {
      const expectedMs = (i * BLOCK_MS) * 1.01
      t.place(expectedMs, frames)
      worst = Math.max(worst, Math.abs(t.endMs - (expectedMs + BLOCK_MS)))
    }
    expect(worst).toBeLessThan(25 + BLOCK_MS)
  })

  it('keeps every timestamp non-decreasing', () => {
    const t = new AudioTimeline({ sampleRate: RATE, toleranceMs: 20 })
    const rand = rng(11)
    let last = -1
    for (let i = 0; i < 2000; i++) {
      const p = t.place(i * BLOCK_MS + (rand() - 0.5) * 300, frames)
      expect(p.timestampUs).toBeGreaterThanOrEqual(last)
      last = p.timestampUs
    }
  })

  it('accounts for padding and trimming in where the audio ends', () => {
    const t = new AudioTimeline({ sampleRate: RATE })
    const a = t.place(0, frames)
    const b = t.place(BLOCK_MS + 200, frames)
    const padded = b.padFrames

    expect(a.padFrames).toBe(0)
    expect(t.endMs).toBeCloseTo(((frames * 2 + padded) / RATE) * 1000, 1)
  })
})
