/**
 * Keeping the audio in step with the picture.
 *
 * Video frames are stamped from the wall clock when they are composed. Audio
 * comes from the audio clock, which runs on its own oscillator: it drifts a
 * little against the wall clock (tens of parts per million on real hardware),
 * and the two have no shared origin. Two small pure pieces deal with that.
 *
 *  - AudioClockMap works out, continuously, how a position on the audio clock
 *    corresponds to wall-clock time.
 *  - AudioTimeline then keeps the encoded audio contiguous and, if it strays
 *    from where the wall clock says it should be, closes the gap with silence
 *    or drops the overlap, rather than leaving timestamps that jump.
 */

// ── Clock map ──────────────────────────────────────────────────────────────

interface EpochMinimum {
  /** Audio-clock time at the middle of the epoch, in ms. */
  ctxMs: number
  /** The lowest (arrival - block end) seen in the epoch. */
  offsetMs: number
}

export interface ClockMapOptions {
  /** How much audio time each epoch covers. */
  epochMs?: number
  /** How many epochs to fit a line through. */
  epochs?: number
  /** The relation to use until enough has been seen, from one paired reading of both clocks. */
  anchor: { ctxSec: number; perfMs: number }
}

/**
 * Relates the audio clock to the wall clock.
 *
 * Each block of audio arrives a little after it was produced, and by a varying
 * amount, so any single arrival is a late and noisy reading of the relation. The
 * lowest arrival-minus-end seen over a short epoch is the closest to the true
 * offset (that block was delivered promptly). A line fitted through the recent
 * epochs' minima then follows slow drift between the clocks.
 */
export class AudioClockMap {
  private readonly epochMs: number
  private readonly maxEpochs: number
  private readonly history: EpochMinimum[] = []

  private epochStartCtxMs: number | null = null
  private epochMin = Infinity
  private readonly anchorOffsetMs: number

  constructor(options: ClockMapOptions) {
    this.epochMs = options.epochMs ?? 2000
    this.maxEpochs = options.epochs ?? 8
    this.anchorOffsetMs = options.anchor.perfMs - options.anchor.ctxSec * 1000
  }

  /**
   * Records a block that started at `ctxStartSec` on the audio clock, lasted
   * `blockMs`, and arrived at wall-clock `arrivedMs`.
   */
  observe(ctxStartSec: number, blockMs: number, arrivedMs: number): void {
    const ctxStartMs = ctxStartSec * 1000
    const sample = arrivedMs - (ctxStartMs + blockMs)

    if (this.epochStartCtxMs === null) this.epochStartCtxMs = ctxStartMs
    this.epochMin = Math.min(this.epochMin, sample)

    if (ctxStartMs - this.epochStartCtxMs >= this.epochMs) {
      this.history.push({
        ctxMs: this.epochStartCtxMs + this.epochMs / 2,
        offsetMs: this.epochMin,
      })
      if (this.history.length > this.maxEpochs) this.history.shift()

      this.epochStartCtxMs = ctxStartMs
      this.epochMin = Infinity
    }
  }

  /** Wall-clock time, in ms, that corresponds to a position on the audio clock. */
  toPerfMs(ctxSec: number): number {
    const ctxMs = ctxSec * 1000
    return ctxMs + this.offsetAt(ctxMs)
  }

  private offsetAt(ctxMs: number): number {
    const points = [...this.history]
    if (Number.isFinite(this.epochMin) && this.epochStartCtxMs !== null) {
      points.push({ ctxMs: this.epochStartCtxMs + this.epochMs / 2, offsetMs: this.epochMin })
    }

    if (points.length === 0) return this.anchorOffsetMs
    if (points.length < 3) {
      // Too little to tell drift from noise: use the best single reading.
      return Math.min(...points.map((p) => p.offsetMs))
    }
    return fitLine(points, ctxMs)
  }
}

/** Least-squares line through the points, evaluated at x, with the slope kept physically plausible. */
function fitLine(points: EpochMinimum[], x: number): number {
  const n = points.length
  const meanX = points.reduce((a, p) => a + p.ctxMs, 0) / n
  const meanY = points.reduce((a, p) => a + p.offsetMs, 0) / n

  let num = 0
  let den = 0
  for (const p of points) {
    num += (p.ctxMs - meanX) * (p.offsetMs - meanY)
    den += (p.ctxMs - meanX) ** 2
  }

  // Oscillators differ by well under 1%; a steeper fit is noise, not drift.
  const slope = den === 0 ? 0 : Math.max(-0.02, Math.min(0.02, num / den))
  return meanY + slope * (x - meanX)
}

// ── Timeline ───────────────────────────────────────────────────────────────

export interface Placement {
  /** Samples of silence to insert before this block. */
  padFrames: number
  /** Samples to drop from the start of this block. */
  skipFrames: number
  /** Where the (padded, trimmed) block begins on the output timeline. */
  timestampUs: number
}

export interface TimelineOptions {
  sampleRate: number
  /** How far audio may stray from the wall clock before it is corrected. */
  toleranceMs?: number
}

/**
 * Lays blocks of audio end to end on the output timeline.
 *
 * Stamping each block from its own measured time would give timestamps that
 * wobble by a few milliseconds, which the encoder and muxer would turn into
 * tiny gaps and overlaps all through the file. Instead blocks are placed
 * back to back, and only when the audio has strayed past the tolerance from
 * where the wall clock says it should be is it corrected.
 */
export class AudioTimeline {
  private readonly rate: number
  private readonly toleranceFrames: number
  /** Frames laid down so far, counted from the output timeline's origin. */
  private position: number | null = null

  constructor({ sampleRate, toleranceMs = 20 }: TimelineOptions) {
    this.rate = sampleRate
    this.toleranceFrames = Math.round((toleranceMs * sampleRate) / 1000)
  }

  /**
   * Places a block that, by the wall clock, should begin at `expectedStartMs`
   * on the output timeline and holds `frames` samples.
   */
  place(expectedStartMs: number, frames: number): Placement {
    const expected = Math.round((expectedStartMs * this.rate) / 1000)

    if (this.position === null) {
      // The first block starts wherever the wall clock says it does.
      this.position = Math.max(0, expected)
    }

    const delta = expected - this.position
    let padFrames = 0
    let skipFrames = 0

    if (delta > this.toleranceFrames) padFrames = delta
    else if (delta < -this.toleranceFrames) skipFrames = Math.min(frames, -delta)

    const start = this.position + padFrames
    this.position = start + (frames - skipFrames)

    return { padFrames, skipFrames, timestampUs: Math.round((start / this.rate) * 1_000_000) }
  }

  /** Where the end of the audio laid down so far is, in ms. */
  get endMs(): number {
    return this.position === null ? 0 : (this.position / this.rate) * 1000
  }
}
