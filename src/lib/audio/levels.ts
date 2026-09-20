/**
 * Level measurement for the audio mixer.
 *
 * Kept free of Web Audio types so the maths can be tested directly on sample
 * buffers. The engine feeds it real data from an AnalyserNode; these functions
 * do not know where the samples came from.
 */

/** Anything at or below this reads as silence rather than a very small number. */
export const SILENCE_DB = -100

/** Meter floor the interface draws from. */
export const FLOOR_DB = -60

export interface ChannelLevels {
  peakL: number
  peakR: number
  rmsL: number
  rmsR: number
}

export const SILENT: ChannelLevels = {
  peakL: SILENCE_DB, peakR: SILENCE_DB, rmsL: SILENCE_DB, rmsR: SILENCE_DB,
}

/**
 * Converts a linear amplitude (0–1) to dBFS.
 *
 * Zero and negative amplitudes have no logarithm, so they clamp to the silence
 * floor rather than returning -Infinity, which would poison any later maths.
 */
export function amplitudeToDb(amplitude: number): number {
  if (!(amplitude > 0)) return SILENCE_DB // also catches NaN
  const db = 20 * Math.log10(amplitude)
  return db < SILENCE_DB ? SILENCE_DB : Math.min(db, 0)
}

/** Root mean square of a sample buffer, as a linear amplitude. */
export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
  return Math.sqrt(sum / samples.length)
}

/** Largest absolute sample in the buffer, as a linear amplitude. */
export function peak(samples: Float32Array): number {
  let max = 0
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i] < 0 ? -samples[i] : samples[i]
    if (v > max) max = v
  }
  return max
}

/**
 * Measures one channel of samples.
 *
 * `gain` applies the fader and mute, matching what the listener hears rather
 * than what arrived at the input — a muted channel must read silent even while
 * the device is still producing signal.
 */
export function measure(samples: Float32Array, gain = 1): { peak: number; rms: number } {
  if (gain <= 0) return { peak: SILENCE_DB, rms: SILENCE_DB }
  return {
    peak: amplitudeToDb(peak(samples) * gain),
    rms: amplitudeToDb(rms(samples) * gain),
  }
}

/**
 * Peak hold with decay.
 *
 * A peak that is not held is invisible: a transient lasting one buffer would
 * be drawn for a single frame. Holding the maximum and letting it fall at a
 * fixed rate is what makes the indicator readable.
 */
export function decayPeak(previous: number, current: number, dbPerSecond: number, elapsedMs: number): number {
  if (current >= previous) return current
  const decayed = previous - (dbPerSecond * elapsedMs) / 1000
  return decayed < current ? current : decayed
}

/** Maps a dBFS reading onto the 0–1 fraction the meter bar fills. */
export function dbToMeterFraction(db: number): number {
  if (db <= FLOOR_DB) return 0
  if (db >= 0) return 1
  return (db - FLOOR_DB) / -FLOOR_DB
}
