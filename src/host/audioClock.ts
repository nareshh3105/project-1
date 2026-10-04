/**
 * Keeping the audio in step with the picture.
 *
 * Video frames are stamped from the wall clock when they are composed. The audio
 * mix arrives as blocks timed on the capture clock and mapped onto the wall
 * clock, with a little jitter. AudioTimeline lays the blocks end to end so the
 * encoded audio is contiguous, and only when it strays from where the wall clock
 * says it should be does it close a gap with silence or drop an overlap, rather
 * than leaving timestamps that wobble or jump.
 */

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
