/*
 * Runs on the audio thread. Collects the mixed audio as raw samples and posts
 * it in blocks with the exact position of its first sample, so the main thread
 * can timestamp it from the audio clock rather than guess from when it arrived.
 */
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.left = []
    this.right = []
    this.count = 0
    this.startFrame = 0
  }

  process(inputs) {
    const input = inputs[0]
    // With nothing connected the graph delivers no channels. The recording still
    // needs a continuous track, so that is silence rather than a gap.
    const l = (input && input[0]) || new Float32Array(128)
    const r = (input && input[1]) || l

    if (this.count === 0) this.startFrame = currentFrame
    this.left.push(l.slice())
    this.right.push(r.slice())
    this.count += l.length

    // 1024 samples is about 21 ms at 48 kHz: small enough to keep latency low,
    // large enough to avoid a message per 128-sample render quantum.
    if (this.count >= 1024) {
      const planar = new Float32Array(this.count * 2)
      let offset = 0
      for (const block of this.left) { planar.set(block, offset); offset += block.length }
      for (const block of this.right) { planar.set(block, offset); offset += block.length }
      this.port.postMessage({ startFrame: this.startFrame, frames: this.count, data: planar.buffer }, [planar.buffer])
      this.left = []
      this.right = []
      this.count = 0
    }
    return true
  }
}

registerProcessor('capture', CaptureProcessor)
