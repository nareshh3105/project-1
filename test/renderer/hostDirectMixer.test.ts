import { describe, it, expect, beforeEach } from 'vitest'
import { DirectMixer, OffsetTracker, BLOCK_FRAMES, type MixBlock, type InputHandle } from '../../src/host/directMixer'
import { OUTPUT_RATE, type RawChunk } from '../../src/host/audioInput'

/**
 * The mix is cut into blocks on the clock the devices keep, so it cannot run slow
 * when the page is busy. These drive it with simulated devices: chunks stamped
 * on a capture clock whose origin is nothing like the page's, arriving late and
 * unevenly, and check what comes out.
 */

/** The capture clock reads this much more than the page's: unrelated origins, as in the browser. */
const CAPTURE_ORIGIN_MS = 23_260_000_000

let now: number
let blocks: MixBlock[]
let mixer: DirectMixer

beforeEach(() => {
  now = 5_000
  blocks = []
  mixer = new DirectMixer({ now: () => now, onBlock: (b) => blocks.push(b) })
})

/** A chunk of `ms` milliseconds of mono audio, captured at page time `capturedAtMs`. */
function chunk(capturedAtMs: number, value: number, ms = 10, rate = OUTPUT_RATE): RawChunk {
  return {
    timestampUs: (capturedAtMs + CAPTURE_ORIGIN_MS) * 1000,
    sampleRate: rate,
    channels: [new Float32Array(Math.round((ms * rate) / 1000)).fill(value)],
  }
}

/**
 * Runs a device for `ms` of page time, delivering a 10 ms chunk every 10 ms, each
 * arriving `latency(i)` after it was captured, and pumping the mixer as it goes.
 */
function run(handle: InputHandle, ms: number, value: number, opts: { latency?: (i: number) => number; from?: number } = {}) {
  const latency = opts.latency ?? (() => 5)
  const from = opts.from ?? now
  for (let t = 0, i = 0; t < ms; t += 10, i++) {
    const captured = from + t
    // A chunk is complete only once all of it was captured; chunks arrive in order, never early.
    const arrives = Math.max(now, captured + 10 + latency(i))
    now = arrives
    handle.push(chunk(captured, value), arrives)
    mixer.pump()
  }
}

/** Runs several devices over the same stretch of time, each chunk captured at the same instants. */
function runTogether(devices: Array<[InputHandle, number]>, ms: number, latency = 15) {
  const from = now
  for (let t = 0; t < ms; t += 10) {
    const captured = from + t
    now = Math.max(now, captured + 10 + latency)
    for (const [handle, value] of devices) handle.push(chunk(captured, value), now)
    mixer.pump()
  }
}

/** Float32 holds 0.4 as 0.4000000059604645; compare as the mixer would store it. */
const f = Math.fround

const samples = (list: MixBlock[]) => list.flatMap((b) => Array.from(b.data.subarray(0, b.frames)))

describe('with nothing connected', () => {
  it('still produces a continuous silent track', () => {
    for (let i = 0; i < 100; i++) { now += 10; mixer.pump() }
    expect(blocks.length).toBeGreaterThan(30)
    expect(blocks.every((b) => b.data.every((v) => v === 0))).toBe(true)
  })

  it('keeps the blocks end to end', () => {
    for (let i = 0; i < 100; i++) { now += 10; mixer.pump() }
    for (let i = 1; i < blocks.length; i++) {
      expect(blocks[i].startSec).toBeCloseTo(blocks[i - 1].startSec + BLOCK_FRAMES / OUTPUT_RATE, 6)
    }
  })

  it('keeps pace with real time', () => {
    for (let i = 0; i < 300; i++) { now += 10; mixer.pump() } // 3 seconds
    const covered = (blocks.length * BLOCK_FRAMES) / OUTPUT_RATE
    expect(covered).toBeGreaterThan(2.8 - 0.1)
    expect(covered).toBeLessThanOrEqual(3)
  })

  it('maps its blocks onto page time directly', () => {
    for (let i = 0; i < 50; i++) { now += 10; mixer.pump() }
    expect(mixer.toWallMs(blocks[0].startSec)).toBeCloseTo(blocks[0].startSec * 1000, 6)
  })
})

describe('with one input', () => {
  let input: InputHandle
  beforeEach(() => { input = mixer.addInput('mic') })

  it('sends nothing until audio has arrived', () => {
    now += 500
    mixer.pump()
    expect(blocks).toHaveLength(0)
  })

  it('sends the audio it was given', () => {
    run(input, 500, 0.25)
    const out = samples(blocks)
    expect(out.length).toBeGreaterThan(10_000)
    expect(out.every((v) => v === f(0.25))).toBe(true)
  })

  it('sends it on the capture clock, which is not the page clock', () => {
    run(input, 500, 0.25)
    expect(blocks[0].startSec * 1000).toBeGreaterThan(CAPTURE_ORIGIN_MS)
  })

  it('maps a block back to page time, to within the delivery delay', () => {
    run(input, 500, 0.25, { from: 5_000 })
    const wall = mixer.toWallMs(blocks[0].startSec)
    expect(wall).toBeGreaterThanOrEqual(5_000 - 1)
    expect(wall).toBeLessThan(5_000 + 25)
  })

  it('keeps the blocks end to end', () => {
    run(input, 1000, 0.1)
    for (let i = 1; i < blocks.length; i++) {
      expect(blocks[i].startSec).toBeCloseTo(blocks[i - 1].startSec + BLOCK_FRAMES / OUTPUT_RATE, 6)
    }
  })

  it('loses nothing: every sample captured comes out', () => {
    run(input, 2000, 0.3)
    const captured = (2000 / 1000) * OUTPUT_RATE
    // All but the block still waiting to fill.
    expect(samples(blocks).length).toBeGreaterThan(captured - 3 * BLOCK_FRAMES)
  })

  it('is not disturbed by uneven delivery', () => {
    run(input, 2000, 0.3, { latency: (i) => 2 + ((i * 7919) % 40) })
    expect(samples(blocks).every((v) => v === f(0.3))).toBe(true)
    expect(mixer.debug().blocksSentLate).toBe(0)
  })

  it('puts a stall in the device where it happened, as silence, without shifting what follows', () => {
    run(input, 300, 0.5)
    const before = blocks.length
    now += 400 // nothing delivered for 400 ms
    run(input, 300, 0.5, { from: now })

    const out = samples(blocks.slice(before - 2))
    const quiet = out.filter((v) => v === 0).length
    expect(quiet).toBeGreaterThan(0.3 * OUTPUT_RATE) // about 400 ms of gap
    expect(quiet).toBeLessThan(0.5 * OUTPUT_RATE)
  })

  it('applies the gain it is given', () => {
    input.setGain(0.5)
    run(input, 300, 0.4)
    expect(samples(blocks).every((v) => Math.abs(v - 0.2) < 1e-6)).toBe(true)
  })

  it('goes silent when the gain is zero, as a mute does', () => {
    input.setGain(0)
    run(input, 300, 0.4)
    expect(blocks.length).toBeGreaterThan(5)
    expect(samples(blocks).every((v) => v === 0)).toBe(true)
  })

  it.each([[NaN, 0], [-3, 0], [Infinity, 0]])('treats a gain of %s as %s', (given, expected) => {
    input.setGain(given)
    run(input, 100, 0.4)
    expect(samples(blocks).every((v) => v === expected)).toBe(true)
  })

  it('can be turned back up', () => {
    input.setGain(0)
    run(input, 200, 0.4)
    input.setGain(1)
    blocks.length = 0
    run(input, 300, 0.4, { from: now })
    expect(samples(blocks).some((v) => v === f(0.4))).toBe(true)
  })

  it('puts a mono input in the middle', () => {
    run(input, 200, 0.4)
    const b = blocks[1]
    expect(Array.from(b.data.subarray(0, 8))).toEqual(Array.from(b.data.subarray(BLOCK_FRAMES, BLOCK_FRAMES + 8)))
  })
})

describe('with several inputs', () => {
  it('adds them together', () => {
    const a = mixer.addInput('a')
    const b = mixer.addInput('b')
    runTogether([[a, 0.2], [b, 0.3]], 400)
    const out = samples(blocks)
    expect(out.length).toBeGreaterThan(5000)
    expect(out.every((v) => Math.abs(v - 0.5) < 1e-6)).toBe(true)
  })

  it('gives each its own gain', () => {
    const a = mixer.addInput('a'); const b = mixer.addInput('b')
    a.setGain(0.5)
    b.setGain(0)
    runTogether([[a, 0.4], [b, 0.9]], 400)
    expect(blocks.length).toBeGreaterThan(5)
    expect(samples(blocks).every((v) => Math.abs(v - 0.2) < 1e-6)).toBe(true)
  })

  it('clips rather than wrapping when the sum is too loud', () => {
    const a = mixer.addInput('a'); const b = mixer.addInput('b')
    runTogether([[a, 0.9], [b, 0.9]], 400)
    const out = samples(blocks)
    expect(Math.max(...out)).toBe(1)
    expect(Math.min(...out)).toBeGreaterThanOrEqual(-1)
  })

  it('lines the inputs up by when they were captured, not when they arrived', () => {
    const a = mixer.addInput('a'); const b = mixer.addInput('b')
    // b arrives 30 ms after a for the same instants.
    for (let t = 0; t < 600; t += 10) {
      a.push(chunk(now + t, 0.2), now + t + 20)
      b.push(chunk(now + t, 0.3), now + t + 50)
    }
    now += 700
    mixer.pump()
    const mid = samples(blocks).slice(2 * BLOCK_FRAMES, 8 * BLOCK_FRAMES)
    expect(mid.every((v) => Math.abs(v - 0.5) < 1e-6)).toBe(true)
  })

  it('waits for a slow input, within reason', () => {
    const a = mixer.addInput('a'); const b = mixer.addInput('b')
    a.push(chunk(now, 0.2, 30), now + 40)
    b.push(chunk(now, 0.3, 10), now + 40)
    mixer.pump()
    expect(blocks).toHaveLength(0) // not enough from either yet
  })

  it('goes on without an input that has gone quiet, and says it did', () => {
    const a = mixer.addInput('a'); mixer.addInput('b')
    runTogether([[a, 0.4]], 600)
    expect(blocks.length).toBeGreaterThan(5)
    expect(mixer.debug().blocksSentLate).toBe(blocks.length)
    // The quiet one contributed nothing; the live one is intact.
    expect(samples(blocks).every((v) => Math.abs(v - 0.4) < 1e-6 || v === 0)).toBe(true)
  })
})

describe('inputs coming and going', () => {
  it('returns to a silent track when the last input is removed', () => {
    const a = mixer.addInput('a')
    run(a, 300, 0.4)
    a.remove()
    blocks.length = 0
    for (let i = 0; i < 100; i++) { now += 10; mixer.pump() }
    expect(blocks.length).toBeGreaterThan(20)
    expect(samples(blocks).every((v) => v === 0)).toBe(true)
  })

  it('takes up an input added later', () => {
    for (let i = 0; i < 50; i++) { now += 10; mixer.pump() }
    const a = mixer.addInput('a')
    blocks.length = 0
    run(a, 500, 0.4, { from: now })
    expect(samples(blocks).some((v) => v === f(0.4))).toBe(true)
  })

  it('starts from the first audio it is given, not from where the silence had got to', () => {
    for (let i = 0; i < 50; i++) { now += 10; mixer.pump() } // half a second of silent blocks
    const a = mixer.addInput('a')
    blocks.length = 0
    const capturedAt = now + 5
    a.push(chunk(capturedAt, 0.4, 10), now + 20)
    run(a, 400, 0.4, { from: capturedAt + 10 })

    const expectedStart = (capturedAt + CAPTURE_ORIGIN_MS) / 1000
    expect(blocks[0].startSec).toBeCloseTo(expectedStart, 2)
  })

  it('ignores audio from an input that has been replaced', () => {
    const old = mixer.addInput('mic')
    const fresh = mixer.addInput('mic')
    old.push(chunk(now, 0.9), now + 15)
    run(fresh, 300, 0.3)
    expect(samples(blocks).every((v) => v !== f(0.9))).toBe(true)
  })

  it('does not let a replaced handle remove its replacement', () => {
    const old = mixer.addInput('mic')
    mixer.addInput('mic')
    old.remove()
    expect(mixer.inputCount).toBe(1)
  })

  it('counts its inputs', () => {
    const a = mixer.addInput('a')
    mixer.addInput('b')
    expect(mixer.inputCount).toBe(2)
    a.remove()
    expect(mixer.inputCount).toBe(1)
  })
})

describe('when the page stalls', () => {
  it('skips ahead rather than sending a burst to catch up', () => {
    const a = mixer.addInput('a')
    run(a, 300, 0.4)
    blocks.length = 0
    now += 20_000 // the page was frozen for twenty seconds
    mixer.pump()
    // Far fewer than the ~940 blocks that were missed.
    expect(blocks.length).toBeLessThan(10)
  })
})

describe('a device whose clock differs from the page', () => {
  // Over a minute the device may deliver slightly more or fewer samples than the page's clock
  // implies. The mix follows the device, so nothing is lost or invented.
  it.each([['slow', 0.999], ['fast', 1.001]])('a %s device loses nothing and invents nothing', (_n, speed) => {
    const input = mixer.addInput('mic')
    const total = 20_000
    for (let t = 0; t < total; t += 10) {
      const captured = now0() + t * speed // device time passes at its own speed
      const arrives = now0() + t + 15
      now = arrives
      input.push({ timestampUs: (captured + CAPTURE_ORIGIN_MS) * 1000, sampleRate: OUTPUT_RATE, channels: [new Float32Array(480).fill(0.5)] }, arrives)
      mixer.pump()
    }
    const out = samples(blocks)
    const quiet = out.filter((v) => v === 0).length
    // Gaps are only the few samples where a faster device overlaps or a slower one leaves a hair of space.
    expect(quiet / out.length).toBeLessThan(0.01)
  })

  function now0() { return 5_000 }
})

describe('OffsetTracker', () => {
  it('has nothing before anything is seen', () => {
    expect(new OffsetTracker().offsetMs).toBeNull()
  })

  it('is the smallest delay seen, because that arrival was the most prompt', () => {
    const t = new OffsetTracker()
    t.observe(0, 30); t.observe(10, 14); t.observe(20, 45)
    expect(t.offsetMs).toBe(4) // 14 - 10
  })

  it('works with captures stamped on a clock far from the page', () => {
    const t = new OffsetTracker()
    t.observe(CAPTURE_ORIGIN_MS, 100); t.observe(CAPTURE_ORIGIN_MS + 10, 112)
    expect(t.offsetMs).toBe(100 - CAPTURE_ORIGIN_MS)
  })

  it('takes the best of the last few seconds, not the latest', () => {
    const t = new OffsetTracker(1000, 8)
    for (let i = 0; i < 200; i++) t.observe(i * 10, i * 10 + 5) // two seconds at 5 ms
    for (let i = 200; i < 400; i++) t.observe(i * 10, i * 10 + 50) // then two at 50 ms
    expect(t.offsetMs).toBe(5)
  })

  it('is not raised for long by one unlucky stretch', () => {
    const t = new OffsetTracker(1000, 4)
    for (let i = 0; i < 100; i++) t.observe(i * 10, i * 10 + 5)
    for (let i = 100; i < 1000; i++) t.observe(i * 10, i * 10 + 80) // delivery stayed slow for a long while
    expect(t.offsetMs).toBe(80)
  })

  it('follows a real change of the offset', () => {
    const t = new OffsetTracker(1000, 3)
    for (let i = 0; i < 1000; i++) t.observe(i * 10, i * 10 + 5)
    for (let i = 1000; i < 2000; i++) t.observe(i * 10, i * 10 + 50)
    expect(t.offsetMs).toBe(50)
  })
})
