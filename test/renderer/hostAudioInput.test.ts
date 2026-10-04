import { describe, it, expect } from 'vitest'
import { InputBuffer, Resampler, samplesAt, OUTPUT_RATE, type RawChunk } from '../../src/host/audioInput'

/**
 * Each input is placed on the capture clock by its own timestamps, so a stall
 * leaves a gap of silence instead of shifting what follows, and duplicates are
 * ignored rather than doubled.
 */

const us = (sample: number) => (sample * 1_000_000) / OUTPUT_RATE
const ramp = (from: number, n: number) => Float32Array.from({ length: n }, (_, i) => from + i)

/** A mono chunk of 48 kHz audio whose first sample is at `start` and whose values count up from `start`. */
const mono = (start: number, n = 480): RawChunk => ({
  timestampUs: us(start), sampleRate: OUTPUT_RATE, channels: [ramp(start, n)],
})
const stereo = (start: number, n = 480): RawChunk => ({
  timestampUs: us(start), sampleRate: OUTPUT_RATE, channels: [ramp(start, n), ramp(-start, n)],
})

describe('samplesAt', () => {
  it.each([[0, 0], [1_000_000, 48000], [10_000, 480], [20_833, 1000]])('%s us is sample %s', (t, s) => {
    expect(samplesAt(t)).toBe(s)
  })
})

describe('InputBuffer', () => {
  it('is empty at first', () => {
    const b = new InputBuffer()
    expect(b.end).toBeNull()
    expect(b.begin).toBeNull()
    expect(b.read(0, 4).left).toEqual(new Float32Array(4))
  })

  it('returns what was pushed, where the timestamp puts it', () => {
    const b = new InputBuffer()
    b.push(mono(1000, 480))
    expect(b.begin).toBe(1000)
    expect(b.end).toBe(1480)
    expect(Array.from(b.read(1000, 3).left)).toEqual([1000, 1001, 1002])
  })

  it('joins consecutive chunks seamlessly', () => {
    const b = new InputBuffer()
    b.push(mono(0)); b.push(mono(480)); b.push(mono(960))
    expect(Array.from(b.read(478, 4).left)).toEqual([478, 479, 480, 481])
    expect(b.end).toBe(1440)
  })

  it('fills a gap with silence, without shifting what comes after', () => {
    const b = new InputBuffer()
    b.push(mono(0, 480))
    b.push(mono(1000, 480)) // 520 samples never arrived
    const out = b.read(470, 40).left
    expect(Array.from(out.subarray(0, 10))).toEqual([470, 471, 472, 473, 474, 475, 476, 477, 478, 479])
    expect(Array.from(out.subarray(10))).toEqual(new Array(30).fill(0))
    expect(Array.from(b.read(1000, 2).left)).toEqual([1000, 1001])
  })

  it('gives silence for time before and after what it holds', () => {
    const b = new InputBuffer()
    b.push(mono(100, 10))
    const out = b.read(95, 20).left
    expect(Array.from(out.subarray(0, 5))).toEqual([0, 0, 0, 0, 0])
    expect(Array.from(out.subarray(5, 15))).toEqual(ramp(100, 10).toString().split(',').map(Number))
    expect(Array.from(out.subarray(15))).toEqual([0, 0, 0, 0, 0])
  })

  it('centres a mono input', () => {
    const b = new InputBuffer()
    b.push(mono(0, 4))
    const { left, right } = b.read(0, 4)
    expect(Array.from(right)).toEqual(Array.from(left))
  })

  it('keeps the two channels of a stereo input apart', () => {
    const b = new InputBuffer()
    b.push(stereo(10, 4))
    const { left, right } = b.read(10, 4)
    expect(Array.from(left)).toEqual([10, 11, 12, 13])
    expect(Array.from(right)).toEqual([-10, -9, -8, -7])
  })

  it('uses the first two channels of a wider input', () => {
    const b = new InputBuffer()
    b.push({ timestampUs: 0, sampleRate: OUTPUT_RATE, channels: [ramp(1, 4), ramp(100, 4), ramp(900, 4), ramp(900, 4)] })
    expect(Array.from(b.read(0, 4).right)).toEqual([100, 101, 102, 103])
  })

  describe('a chunk that arrives again, or overlaps', () => {
    it('is ignored when it is a repeat', () => {
      const b = new InputBuffer()
      b.push(mono(0)); b.push(mono(0))
      expect(b.end).toBe(480)
    })

    it('adds only the part that is new', () => {
      const b = new InputBuffer()
      b.push(mono(0, 480))
      b.push(mono(400, 480)) // 80 samples overlap
      expect(b.end).toBe(880)
      expect(Array.from(b.read(478, 4).left)).toEqual([478, 479, 480, 481])
    })

    it('keeps the earlier copy of the overlap', () => {
      const b = new InputBuffer()
      b.push(mono(0, 10))
      b.push({ timestampUs: us(5), sampleRate: OUTPUT_RATE, channels: [new Float32Array(10).fill(99)] })
      expect(Array.from(b.read(5, 5).left)).toEqual([5, 6, 7, 8, 9])
      expect(Array.from(b.read(10, 5).left)).toEqual([99, 99, 99, 99, 99])
    })
  })

  it('does not keep the arrays it was given', () => {
    const b = new InputBuffer()
    const data = ramp(0, 4)
    b.push({ timestampUs: 0, sampleRate: OUTPUT_RATE, channels: [data] })
    data.fill(7)
    expect(Array.from(b.read(0, 4).left)).toEqual([0, 1, 2, 3])
  })

  it('ignores empty chunks', () => {
    const b = new InputBuffer()
    b.push({ timestampUs: 0, sampleRate: OUTPUT_RATE, channels: [] })
    b.push({ timestampUs: 0, sampleRate: OUTPUT_RATE, channels: [new Float32Array(0)] })
    expect(b.end).toBeNull()
    expect(b.received).toBe(0)
  })

  describe('forgetting the past', () => {
    it('drops what is wholly behind', () => {
      const b = new InputBuffer()
      b.push(mono(0)); b.push(mono(480)); b.push(mono(960))
      b.discardBefore(960)
      expect(b.begin).toBe(960)
    })

    it('trims a chunk that is partly behind', () => {
      const b = new InputBuffer()
      b.push(mono(0, 480))
      b.discardBefore(100)
      expect(b.begin).toBe(100)
      expect(Array.from(b.read(100, 2).left)).toEqual([100, 101])
    })

    it('leaves the future alone', () => {
      const b = new InputBuffer()
      b.push(mono(1000))
      b.discardBefore(10)
      expect(b.begin).toBe(1000)
    })

    it('can be emptied', () => {
      const b = new InputBuffer()
      b.push(mono(0))
      b.discardBefore(1_000_000)
      expect(b.end).toBeNull()
    })
  })

  it('cannot grow without limit if nobody prunes it', () => {
    const b = new InputBuffer()
    for (let i = 0; i < 2000; i++) b.push(mono(i * 480, 480)) // 20 seconds
    expect(b.end! - b.begin!).toBeLessThanOrEqual(OUTPUT_RATE * 10 + 480)
  })

  it('resamples an input at another rate, keeping its place on the clock', () => {
    const b = new InputBuffer(44100)
    b.push({ timestampUs: 1_000_000, sampleRate: 44100, channels: [new Float32Array(441).fill(0.5)] }) // 10 ms
    expect(b.begin).toBe(48000)
    expect(b.end! - b.begin!).toBeGreaterThanOrEqual(478)
    expect(b.end! - b.begin!).toBeLessThanOrEqual(480)
  })
})

describe('Resampler', () => {
  it('passes 48 kHz through untouched', () => {
    const data = ramp(0, 10)
    expect(new Resampler(48000).process(data)).toBe(data)
  })

  it.each([[44100], [32000], [16000], [8000], [96000]])('gives the right number of samples from %s Hz over a second', (rate) => {
    const r = new Resampler(rate)
    let out = 0
    for (let i = 0; i < 100; i++) out += r.process(new Float32Array(rate / 100)).length
    // Nothing can be made past the last input sample, so the end may be short by up to one input period.
    expect(OUTPUT_RATE - out).toBeGreaterThanOrEqual(0)
    expect(OUTPUT_RATE - out).toBeLessThanOrEqual(Math.ceil(OUTPUT_RATE / rate) + 1)
  })

  it('keeps a constant level constant', () => {
    const out = new Resampler(44100).process(new Float32Array(441).fill(0.25))
    expect(out.every((v) => Math.abs(v - 0.25) < 1e-6)).toBe(true)
  })

  it('has no break at the join between chunks', () => {
    // A slow ramp split into chunks: the output must stay a smooth ramp across the joins.
    const r = new Resampler(44100)
    const all: number[] = []
    for (let c = 0; c < 20; c++) {
      all.push(...r.process(Float32Array.from({ length: 441 }, (_, i) => (c * 441 + i) / 10_000)))
    }
    const steps = all.slice(1).map((v, i) => v - all[i])
    const spread = Math.max(...steps) - Math.min(...steps)
    expect(spread).toBeLessThan(2e-5)
    expect(Math.min(...steps)).toBeGreaterThan(0)
  })

  it('keeps the pitch: a tone stays at its frequency', () => {
    const rate = 44100
    const tone = Float32Array.from({ length: rate }, (_, i) => Math.sin((2 * Math.PI * 1000 * i) / rate))
    const out = new Resampler(rate).process(tone)
    let crossings = 0
    for (let i = 1; i < out.length; i++) if (out[i - 1] < 0 && out[i] >= 0) crossings++
    expect(Math.abs(crossings - 1000)).toBeLessThanOrEqual(2)
  })

  it('copes with an empty chunk', () => {
    expect(new Resampler(44100).process(new Float32Array(0))).toHaveLength(0)
  })

  it('copes with a chunk of one sample', () => {
    expect(() => new Resampler(44100).process(new Float32Array(1))).not.toThrow()
  })
})
