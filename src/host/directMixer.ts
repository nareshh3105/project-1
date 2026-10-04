import { InputBuffer, OUTPUT_RATE, type RawChunk } from './audioInput'

/**
 * Sums the audio inputs into one stereo mix, timed by the clock the devices
 * themselves keep.
 *
 * An earlier design ran the inputs through Web Audio and read the mix from a
 * worklet. Web Audio renders on a clock of its own, and under video load that
 * clock measured as slow as 95% of real time, so about 5% of the sound was lost
 * and replaced with silence. The capture devices deliver exactly their rate
 * (measured 99.96%), so here the mixer reads what they deliver, places each
 * chunk by the time the device captured it, and cuts the mix into blocks on that
 * same clock. Nothing in the path can run slow.
 */

/** Frames in each block handed on. About 21 ms, small enough for low latency. */
export const BLOCK_FRAMES = 1024

/** How long a block waits for a slow input before going out without it. */
const DEFAULT_MAX_WAIT_MS = 80

/** If the mixer falls this far behind real time it skips ahead rather than catch up in a burst. */
const MAX_LAG_MS = 1000

export interface MixBlock {
  /** Position of the first sample on the capture clock, in seconds. */
  startSec: number
  frames: number
  /** Planar float32: left, then right. */
  data: Float32Array
}

export interface DirectMixerDeps {
  /** The page's clock, in milliseconds (performance.now). */
  now(): number
  onBlock(block: MixBlock): void
}

/**
 * Relates the capture clock to the page's clock.
 *
 * A chunk arrives some time after it was captured, by a varying amount, so any
 * one arrival is a late reading. The smallest delay seen lately is the closest to
 * the truth. It is the minimum of each second's minimum over the last few seconds,
 * so one unlucky second does not raise it for long, and a real shift is followed.
 */
export class OffsetTracker {
  private readonly epochs: number[] = []
  private epochStart = 0
  private epochMin = Infinity
  private started = false

  constructor(private readonly epochMs = 1000, private readonly keep = 8) {}

  observe(captureMs: number, arrivalMs: number): void {
    const delay = arrivalMs - captureMs
    if (!this.started) { this.started = true; this.epochStart = arrivalMs }
    this.epochMin = Math.min(this.epochMin, delay)

    if (arrivalMs - this.epochStart >= this.epochMs) {
      this.epochs.push(this.epochMin)
      if (this.epochs.length > this.keep) this.epochs.shift()
      this.epochStart = arrivalMs
      this.epochMin = Infinity
    }
  }

  /** Page time minus capture time, in ms; null before anything has been seen. */
  get offsetMs(): number | null {
    const all = Number.isFinite(this.epochMin) ? [...this.epochs, this.epochMin] : this.epochs
    return all.length ? Math.min(...all) : null
  }
}

interface Input {
  buffer: InputBuffer
  gain: number
}

export interface InputHandle {
  push(chunk: RawChunk, arrivalMs: number): void
  setGain(gain: number): void
  remove(): void
}

export class DirectMixer {
  private readonly inputs = new Map<string, Input>()
  private readonly offset = new OffsetTracker()
  /** Where the next block begins, in samples on the capture clock; null until known. */
  private next: number | null = null
  /** Whether the clock being followed is a device's (true) or just the page's (no inputs). */
  private onDeviceClock = false

  private emitted = 0
  private late = 0

  constructor(
    private readonly deps: DirectMixerDeps,
    private readonly maxWaitMs = DEFAULT_MAX_WAIT_MS,
  ) {}

  addInput(id: string, inputRate: number = OUTPUT_RATE): InputHandle {
    const input: Input = { buffer: new InputBuffer(inputRate), gain: 1 }
    this.inputs.set(id, input)

    return {
      push: (chunk, arrivalMs) => {
        // Only the live input of this name counts: a stale handle must not feed a replacement.
        if (this.inputs.get(id) !== input) return
        this.offset.observe(chunk.timestampUs / 1000, arrivalMs)
        input.buffer.push(chunk)
      },
      setGain: (gain) => { input.gain = Number.isFinite(gain) ? Math.min(4, Math.max(0, gain)) : 0 },
      remove: () => {
        if (this.inputs.get(id) !== input) return
        this.inputs.delete(id)
        if (this.inputs.size === 0) this.next = null
      },
    }
  }

  get inputCount(): number {
    return this.inputs.size
  }

  /** The page time, in ms, that a position on the capture clock corresponds to. */
  toWallMs(captureSec: number): number {
    return captureSec * 1000 + (this.onDeviceClock ? this.offset.offsetMs ?? 0 : 0)
  }

  /** Hands on every block that is ready. Called on a timer. */
  pump(): void {
    const now = this.deps.now()

    if (this.inputs.size === 0) {
      this.pumpSilence(now)
      return
    }

    const offset = this.offset.offsetMs
    if (offset === null) return // nothing has been captured yet, so there is no clock to follow

    // The device clock has just taken over from the page's: start the cursor afresh.
    if (!this.onDeviceClock) { this.onDeviceClock = true; this.next = null }

    const nowSample = Math.floor(((now - offset) * OUTPUT_RATE) / 1000)

    if (this.next === null) {
      const begins = [...this.inputs.values()].map((i) => i.buffer.begin).filter((b): b is number => b !== null)
      if (begins.length === 0) return
      this.next = Math.min(...begins)
    }

    // Far behind (the page was stalled): skip ahead rather than send a burst.
    const maxLag = Math.round((MAX_LAG_MS * OUTPUT_RATE) / 1000)
    if (nowSample - this.next > maxLag) this.next = nowSample - BLOCK_FRAMES * 4

    const waitSamples = Math.round((this.maxWaitMs * OUTPUT_RATE) / 1000)
    let start: number = this.next
    for (;;) {
      const end: number = start + BLOCK_FRAMES

      const present = [...this.inputs.values()].every((i) => (i.buffer.end ?? -1) >= end)
      const waitedLongEnough = nowSample >= end + waitSamples
      if (!present && !waitedLongEnough) break

      if (!present) this.late++
      this.deps.onBlock(this.mix(start))
      for (const i of this.inputs.values()) i.buffer.discardBefore(end)
      start = end
      this.next = end
    }
  }

  debug() {
    return {
      inputs: this.inputs.size,
      blocks: this.emitted,
      blocksSentLate: this.late,
      offsetMs: this.offset.offsetMs,
      onDeviceClock: this.onDeviceClock,
    }
  }

  // ── internals ──

  /** With nothing connected the recording still needs a continuous (silent) track. */
  private pumpSilence(now: number): void {
    if (this.onDeviceClock) { this.onDeviceClock = false; this.next = null }

    const nowSample = Math.floor((now * OUTPUT_RATE) / 1000)
    const waitSamples = Math.round((this.maxWaitMs * OUTPUT_RATE) / 1000)
    if (this.next === null) this.next = nowSample - waitSamples

    while (this.next + BLOCK_FRAMES + waitSamples <= nowSample) {
      this.emitted++
      this.deps.onBlock({
        startSec: this.next / OUTPUT_RATE,
        frames: BLOCK_FRAMES,
        data: new Float32Array(BLOCK_FRAMES * 2),
      })
      this.next += BLOCK_FRAMES
    }
  }

  private mix(start: number): MixBlock {
    const left = new Float32Array(BLOCK_FRAMES)
    const right = new Float32Array(BLOCK_FRAMES)

    for (const input of this.inputs.values()) {
      if (input.gain === 0) continue
      const part = input.buffer.read(start, BLOCK_FRAMES)
      for (let i = 0; i < BLOCK_FRAMES; i++) {
        left[i] += part.left[i] * input.gain
        right[i] += part.right[i] * input.gain
      }
    }

    // Two loud inputs can add up past full scale; clip rather than wrap.
    const out = new Float32Array(BLOCK_FRAMES * 2)
    for (let i = 0; i < BLOCK_FRAMES; i++) {
      out[i] = Math.max(-1, Math.min(1, left[i]))
      out[BLOCK_FRAMES + i] = Math.max(-1, Math.min(1, right[i]))
    }

    this.emitted++
    return { startSec: start / OUTPUT_RATE, frames: BLOCK_FRAMES, data: out }
  }
}
