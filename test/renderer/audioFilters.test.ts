import { describe, it, expect } from 'vitest'
import { FilterChain, DEFAULT_FILTERS, parseFilters, isActive, type AudioFilters } from '../../shared/audioFilters'

/**
 * The microphone filters, measured on generated sound: a steady tone at a known
 * level goes in, and the level that comes out is checked in decibels.
 */

const RATE = 48000

/** A sine tone at `db` dBFS peak, `seconds` long, the same in both channels. */
function tone(db: number, seconds: number, freq = 440) {
  const n = Math.round(seconds * RATE)
  const amp = Math.pow(10, db / 20)
  const left = new Float32Array(n)
  for (let i = 0; i < n; i++) left[i] = amp * Math.sin((2 * Math.PI * freq * i) / RATE)
  return { left, right: left.slice() }
}

/** Peak level in dBFS of the last `seconds` of a signal. */
function peakDb(x: Float32Array, lastSeconds = 0.2) {
  let p = 0
  for (let i = Math.max(0, x.length - Math.round(lastSeconds * RATE)); i < x.length; i++) p = Math.max(p, Math.abs(x[i]))
  return p > 0 ? 20 * Math.log10(p) : -200
}

/** Runs a signal through in 1024-sample blocks, as the mixer does. */
function run(chain: FilterChain, s: { left: Float32Array; right: Float32Array }) {
  for (let i = 0; i < s.left.length; i += 1024) {
    chain.process(s.left.subarray(i, i + 1024), s.right.subarray(i, i + 1024))
  }
  return s
}

const filters = (over: Partial<AudioFilters> & { gate?: Partial<AudioFilters['gate']>; compressor?: Partial<AudioFilters['compressor']> }): AudioFilters => ({
  ...DEFAULT_FILTERS,
  ...over,
  gate: { ...DEFAULT_FILTERS.gate, ...over.gate },
  compressor: { ...DEFAULT_FILTERS.compressor, ...over.compressor },
})

function chainWith(f: AudioFilters) {
  const c = new FilterChain(RATE)
  c.set(f)
  return c
}

describe('nothing switched on', () => {
  it('leaves the sound exactly as it was', () => {
    const s = tone(-12, 0.5)
    const before = s.left.slice()
    run(chainWith(DEFAULT_FILTERS), s)
    expect(s.left).toEqual(before)
  })
})

describe('gain', () => {
  it.each([[6], [-6], [12], [-20]])('changes the level by %s dB', (db) => {
    const s = run(chainWith(filters({ gainDb: db })), tone(-20, 0.5))
    expect(peakDb(s.left)).toBeCloseTo(-20 + db, 1)
  })
})

describe('noise gate', () => {
  const gate = filters({ gate: { enabled: true, openDb: -30, closeDb: -36, holdMs: 100 } })

  it('silences quiet background noise', () => {
    const s = run(chainWith(gate), tone(-50, 1))
    expect(peakDb(s.left)).toBeLessThan(-90)
  })

  it('lets speech-level sound through untouched', () => {
    const s = run(chainWith(gate), tone(-12, 1))
    expect(peakDb(s.left)).toBeCloseTo(-12, 1)
  })

  it('fades down after the voice stops, once the hold has passed, and ends silent', () => {
    const c = chainWith(gate)
    run(c, tone(-12, 0.5))
    // Fading rather than cutting, so the ends of words are not chopped: well down within 0.6 s...
    const soon = run(c, tone(-50, 0.6))
    expect(peakDb(soon.left, 0.1)).toBeLessThan(-65)
    // ...and silent shortly after.
    const later = run(c, tone(-50, 1))
    expect(peakDb(later.left, 0.1)).toBeLessThan(-90)
  })

  it('stays open during the hold, so the ends of words are not cut', () => {
    const c = chainWith(gate)
    run(c, tone(-12, 0.5))
    const after = run(c, tone(-45, 0.06)) // shorter than the 100 ms hold
    expect(peakDb(after.left, 0.02)).toBeGreaterThan(-47)
  })

  it('opens again quickly when speech returns, without a click', () => {
    const c = chainWith(gate)
    run(c, tone(-50, 0.5))
    const back = run(c, tone(-12, 0.1))
    expect(peakDb(back.left, 0.05)).toBeCloseTo(-12, 0)
    // The first samples rise smoothly rather than jumping to full.
    expect(Math.abs(back.left[1])).toBeLessThan(0.05)
  })

  it('does not chatter for a level between closing and opening', () => {
    const c = chainWith(gate)
    run(c, tone(-12, 0.3))
    const between = run(c, tone(-33, 1)) // under open (-30), over close (-36)
    expect(peakDb(between.left, 0.2)).toBeCloseTo(-33, 0)
  })
})

describe('compressor', () => {
  const comp = filters({ compressor: { enabled: true, thresholdDb: -18, ratio: 4, attackMs: 5, releaseMs: 50, makeupDb: 0 } })

  it('reduces a loud sound by the ratio: 12 dB over at 4:1 comes out 3 dB over', () => {
    const s = run(chainWith(comp), tone(-6, 1))
    expect(peakDb(s.left)).toBeCloseTo(-15, 0)
  })

  it('leaves quiet sound alone', () => {
    const s = run(chainWith(comp), tone(-30, 1))
    expect(peakDb(s.left)).toBeCloseTo(-30, 1)
  })

  it('adds the makeup gain afterwards', () => {
    const s = run(chainWith(filters({ compressor: { ...comp.compressor, makeupDb: 6 } })), tone(-6, 1))
    expect(peakDb(s.left)).toBeCloseTo(-9, 0)
  })

  it('evens out loud and quiet speech', () => {
    const loud = run(chainWith(comp), tone(-3, 1))
    const quiet = run(chainWith(comp), tone(-18, 1))
    const inDiff = 15
    const outDiff = peakDb(loud.left) - peakDb(quiet.left)
    expect(outDiff).toBeLessThan(inDiff / 2)
  })

  it('lets go after a loud moment', () => {
    const c = chainWith(comp)
    run(c, tone(-6, 0.5))
    const after = run(c, tone(-30, 0.5))
    expect(peakDb(after.left, 0.1)).toBeCloseTo(-30, 0)
  })
})

describe('in order: gain, gate, compressor', () => {
  it('raises a quiet microphone above the gate with gain', () => {
    const f = filters({ gainDb: 20, gate: { enabled: true, openDb: -30, closeDb: -36, holdMs: 100 } })
    const s = run(chainWith(f), tone(-40, 1)) // -20 after gain, over the gate
    expect(peakDb(s.left)).toBeCloseTo(-20, 0)
  })

  it('keeps left and right together', () => {
    const f = filters({ compressor: { ...DEFAULT_FILTERS.compressor, enabled: true } })
    const s = tone(-6, 0.5)
    for (let i = 0; i < s.right.length; i++) s.right[i] *= 0.5 // right 6 dB quieter
    run(chainWith(f), s)
    expect(peakDb(s.left) - peakDb(s.right)).toBeCloseTo(6, 0)
  })

  it('never produces anything but numbers', () => {
    const f = filters({ gainDb: 30, gate: { enabled: true }, compressor: { enabled: true, ratio: 32 } })
    const s = run(chainWith(f), tone(0, 0.5))
    expect(s.left.every(Number.isFinite)).toBe(true)
  })
})

describe('parseFilters', () => {
  it('is the defaults for nothing', () => {
    expect(parseFilters(undefined)).toEqual(DEFAULT_FILTERS)
    expect(parseFilters('x')).toEqual(DEFAULT_FILTERS)
  })

  it('keeps sensible values', () => {
    const f = filters({ gainDb: 6, gate: { enabled: true, openDb: -40, closeDb: -45, holdMs: 300 } })
    expect(parseFilters(JSON.parse(JSON.stringify(f)))).toEqual(f)
  })

  it('clamps what is out of range', () => {
    const f = parseFilters({ gainDb: 99, compressor: { ratio: 0, attackMs: -5, thresholdDb: 10 } })
    expect(f.gainDb).toBe(30)
    expect(f.compressor.ratio).toBe(1)
    expect(f.compressor.attackMs).toBe(0.1)
    expect(f.compressor.thresholdDb).toBe(0)
  })

  it('never lets the gate close above where it opens', () => {
    expect(parseFilters({ gate: { openDb: -40, closeDb: -10 } }).gate.closeDb).toBe(-40)
  })

  it('takes only true as enabled', () => {
    expect(parseFilters({ gate: { enabled: 'yes' } }).gate.enabled).toBe(false)
  })

  it('knows when nothing would change the sound', () => {
    expect(isActive(DEFAULT_FILTERS)).toBe(false)
    expect(isActive(filters({ gainDb: 1 }))).toBe(true)
    expect(isActive(filters({ compressor: { enabled: true } }))).toBe(true)
  })
})
