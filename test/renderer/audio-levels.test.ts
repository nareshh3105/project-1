import { describe, it, expect } from 'vitest'
import {
  amplitudeToDb, rms, peak, measure, decayPeak, dbToMeterFraction,
  SILENCE_DB, FLOOR_DB,
} from '../../src/lib/audio/levels'

/**
 * Meter maths. These numbers are what a user reads off the mixer, so the
 * reference points matter: full scale is 0 dBFS, half amplitude is about
 * -6 dB, and silence must not become -Infinity or NaN.
 */

/** A sine wave of the given peak amplitude. */
function sine(amplitude: number, samples = 1024): Float32Array {
  const buf = new Float32Array(samples)
  for (let i = 0; i < samples; i++) {
    buf[i] = amplitude * Math.sin((2 * Math.PI * i) / 64)
  }
  return buf
}

const constant = (value: number, samples = 1024) =>
  new Float32Array(samples).fill(value)

describe('amplitudeToDb', () => {
  it('maps full scale to 0 dBFS', () => {
    expect(amplitudeToDb(1)).toBe(0)
  })

  it('maps half amplitude to about -6 dB', () => {
    expect(amplitudeToDb(0.5)).toBeCloseTo(-6.02, 1)
  })

  it('maps a tenth to -20 dB', () => {
    expect(amplitudeToDb(0.1)).toBeCloseTo(-20, 5)
  })

  // -Infinity would poison every later calculation, including the decay.
  it('floors silence instead of returning negative infinity', () => {
    expect(amplitudeToDb(0)).toBe(SILENCE_DB)
    expect(Number.isFinite(amplitudeToDb(0))).toBe(true)
  })

  it('floors a vanishingly small amplitude', () => {
    expect(amplitudeToDb(1e-12)).toBe(SILENCE_DB)
  })

  it('treats NaN as silence rather than propagating it', () => {
    expect(amplitudeToDb(NaN)).toBe(SILENCE_DB)
  })

  it('never reports above full scale', () => {
    // Clipping should read 0, not a positive number the meter cannot draw.
    expect(amplitudeToDb(2)).toBe(0)
  })
})

describe('rms', () => {
  it('is zero for silence', () => {
    expect(rms(constant(0))).toBe(0)
  })

  it('equals the level of a constant signal', () => {
    expect(rms(constant(0.5))).toBeCloseTo(0.5, 6)
  })

  // The defining property of RMS for sine: peak / sqrt(2).
  it('is about 0.707 of peak for a sine wave', () => {
    expect(rms(sine(1))).toBeCloseTo(Math.SQRT1_2, 2)
  })

  it('is unaffected by the sign of the signal', () => {
    expect(rms(constant(-0.5))).toBeCloseTo(rms(constant(0.5)), 6)
  })

  it('handles an empty buffer without dividing by zero', () => {
    expect(rms(new Float32Array(0))).toBe(0)
  })
})

describe('peak', () => {
  it('finds the largest magnitude', () => {
    expect(peak(new Float32Array([0.1, -0.8, 0.3]))).toBeCloseTo(0.8, 6)
  })

  it('is zero for silence', () => {
    expect(peak(constant(0))).toBe(0)
  })

  it('reaches the amplitude of a sine wave', () => {
    expect(peak(sine(0.6))).toBeCloseTo(0.6, 2)
  })

  it('handles an empty buffer', () => {
    expect(peak(new Float32Array(0))).toBe(0)
  })
})

describe('measure', () => {
  it('reports peak above rms for a sine wave', () => {
    const { peak: p, rms: r } = measure(sine(1))
    expect(p).toBeGreaterThan(r)
  })

  // A muted channel must read silent even though the device is still
  // producing signal, because that is what the listener hears.
  it('reads silent at zero gain despite a live signal', () => {
    expect(measure(sine(1), 0)).toEqual({ peak: SILENCE_DB, rms: SILENCE_DB })
  })

  it('lowers the reading as the fader comes down', () => {
    const full = measure(sine(1), 1)
    const half = measure(sine(1), 0.5)

    expect(half.rms).toBeLessThan(full.rms)
    expect(half.rms).toBeCloseTo(full.rms - 6.02, 1)
  })

  it('reads silent for a silent input', () => {
    expect(measure(constant(0))).toEqual({ peak: SILENCE_DB, rms: SILENCE_DB })
  })

  it('never exceeds full scale even when the gain would', () => {
    expect(measure(sine(1), 4).peak).toBe(0)
  })
})

describe('decayPeak', () => {
  it('jumps straight to a louder peak', () => {
    expect(decayPeak(-40, -10, 20, 16)).toBe(-10)
  })

  it('falls gradually rather than dropping instantly', () => {
    const held = decayPeak(-10, -60, 20, 100)
    // 20 dB/s over 100 ms is 2 dB.
    expect(held).toBeCloseTo(-12, 5)
  })

  it('decays proportionally to elapsed time', () => {
    expect(decayPeak(-10, -60, 20, 500)).toBeCloseTo(-20, 5)
  })

  it('never falls below the current level', () => {
    expect(decayPeak(-10, -12, 20, 10_000)).toBe(-12)
  })

  it('holds steady when the signal is unchanged', () => {
    expect(decayPeak(-20, -20, 20, 16)).toBe(-20)
  })
})

describe('dbToMeterFraction', () => {
  it('fills completely at full scale', () => {
    expect(dbToMeterFraction(0)).toBe(1)
  })

  it('is empty at and below the floor', () => {
    expect(dbToMeterFraction(FLOOR_DB)).toBe(0)
    expect(dbToMeterFraction(-100)).toBe(0)
  })

  it('is half full at the midpoint of the scale', () => {
    expect(dbToMeterFraction(FLOOR_DB / 2)).toBeCloseTo(0.5, 6)
  })

  it('rises monotonically', () => {
    const points = [-60, -40, -20, -10, -3, 0].map(dbToMeterFraction)
    for (let i = 1; i < points.length; i++) {
      expect(points[i]).toBeGreaterThan(points[i - 1])
    }
  })

  it('stays within the drawable range', () => {
    for (const db of [-200, -60, -30, 0, 10]) {
      const f = dbToMeterFraction(db)
      expect(f).toBeGreaterThanOrEqual(0)
      expect(f).toBeLessThanOrEqual(1)
    }
  })
})
