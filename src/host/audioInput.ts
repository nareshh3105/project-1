/**
 * What one audio input hands the mixer: stereo samples at 48 kHz, placed on the
 * capture clock by the time the device says they were captured.
 *
 * Placing each chunk by its own timestamp, rather than by counting samples since
 * the start, means a hiccup in the device leaves a gap (filled with silence)
 * instead of shifting everything after it.
 */

export const OUTPUT_RATE = 48000

/** One chunk as the browser delivers it: planar samples, a rate, and when it began. */
export interface RawChunk {
  /** Capture time of the first sample, in microseconds. */
  timestampUs: number
  sampleRate: number
  /** One array per channel. */
  channels: Float32Array[]
}

/** Samples on the capture clock: whole numbers of 1/48000 s. */
export const samplesAt = (timestampUs: number) => Math.round((timestampUs * OUTPUT_RATE) / 1_000_000)

/** Linear resampling that carries on correctly from one chunk to the next. */
export class Resampler {
  /** Position of the next output sample, in input samples, relative to the start of the next chunk. */
  private position = 0
  private last = 0

  constructor(private readonly inputRate: number) {}

  get identity(): boolean {
    return this.inputRate === OUTPUT_RATE
  }

  /** Converts a chunk of one channel. */
  process(input: Float32Array): Float32Array {
    if (this.identity) return input
    if (input.length === 0) return new Float32Array(0)

    const step = this.inputRate / OUTPUT_RATE
    const out: number[] = []
    let p = this.position

    // p is measured from the first sample of this chunk; -1 is the last sample of the previous one.
    while (p < input.length - 1) {
      const i = Math.floor(p)
      const frac = p - i
      const a = i < 0 ? this.last : input[i]
      const b = input[i + 1]
      out.push(a + (b - a) * frac)
      p += step
    }

    this.position = p - input.length
    this.last = input[input.length - 1]
    return Float32Array.from(out)
  }
}

/** A run of consecutive samples starting at `start` on the capture clock. */
interface Segment {
  start: number
  left: Float32Array
  right: Float32Array
}

/** Holds the recent past of one input and hands out any stretch of it. */
export class InputBuffer {
  private segments: Segment[] = []
  private readonly resamplers: Resampler[] = []
  private chunks = 0

  /** Samples held, at most, before the oldest are dropped: a safety net, as the mixer prunes as it goes. */
  private static readonly MAX_SAMPLES = OUTPUT_RATE * 10

  constructor(private readonly inputRate: number = OUTPUT_RATE) {}

  /** End of the latest sample received, on the capture clock; null before any. */
  get end(): number | null {
    const last = this.segments.at(-1)
    return last ? last.start + last.left.length : null
  }

  /** Where the earliest held sample begins; null before any. */
  get begin(): number | null {
    return this.segments[0]?.start ?? null
  }

  get received(): number {
    return this.chunks
  }

  push(chunk: RawChunk): void {
    const { channels } = chunk
    if (channels.length === 0 || channels[0].length === 0) return

    // Mono is centred; more than two channels keep the first two.
    const left = this.resample(0, channels[0])
    const right = channels.length > 1 ? this.resample(1, channels[1]) : left
    const frames = Math.min(left.length, right.length)
    if (frames === 0) return

    this.chunks++
    let start = samplesAt(chunk.timestampUs)
    let l = left.length === frames ? left : left.subarray(0, frames)
    let r = right.length === frames ? right : right.subarray(0, frames)

    // Anything that overlaps what is already held is the same audio again: keep the earlier copy.
    const end = this.end
    if (end !== null && start < end) {
      const skip = end - start
      if (skip >= frames) return
      l = l.subarray(skip)
      r = r.subarray(skip)
      start = end
    }

    // Copied: the caller's buffers are not ours to keep.
    this.segments.push({ start, left: Float32Array.from(l), right: Float32Array.from(r) })
    this.trim()
  }

  /**
   * `count` samples from `start`, silence wherever nothing was received.
   * Returns planar left and right.
   */
  read(start: number, count: number): { left: Float32Array; right: Float32Array } {
    const left = new Float32Array(count)
    const right = new Float32Array(count)
    const stop = start + count

    for (const seg of this.segments) {
      const segEnd = seg.start + seg.left.length
      if (segEnd <= start) continue
      if (seg.start >= stop) break

      const from = Math.max(start, seg.start)
      const to = Math.min(stop, segEnd)
      left.set(seg.left.subarray(from - seg.start, to - seg.start), from - start)
      right.set(seg.right.subarray(from - seg.start, to - seg.start), from - start)
    }
    return { left, right }
  }

  /** Forgets everything before `sample`; it will not be asked for again. */
  discardBefore(sample: number): void {
    while (this.segments.length > 0) {
      const seg = this.segments[0]
      const segEnd = seg.start + seg.left.length
      if (segEnd <= sample) { this.segments.shift(); continue }
      if (seg.start < sample) {
        const cut = sample - seg.start
        this.segments[0] = { start: sample, left: seg.left.subarray(cut), right: seg.right.subarray(cut) }
      }
      break
    }
  }

  private resample(channel: number, data: Float32Array): Float32Array {
    if (this.inputRate === OUTPUT_RATE) return data
    this.resamplers[channel] ??= new Resampler(this.inputRate)
    return this.resamplers[channel].process(data)
  }

  private trim(): void {
    let total = 0
    for (const s of this.segments) total += s.left.length
    while (total > InputBuffer.MAX_SAMPLES && this.segments.length > 1) {
      total -= this.segments[0].left.length
      this.segments.shift()
    }
  }
}
