import { describe, it, expect } from 'vitest'
import { AudioTimeline } from '../../src/host/audioClock'

/**
 * Video is stamped from the wall clock; the audio mix arrives timed on the
 * capture clock, with jitter. The timeline lays it end to end and corrects it
 * only when it strays, because a mistake here is invisible in a short test and
 * shows up as lip-sync drift after an hour.
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
