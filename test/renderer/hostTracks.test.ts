import { describe, it, expect } from 'vitest'
import { EncoderSession, SAMPLE_RATE, type SessionDeps, type MuxerOptions } from '../../src/host/session'
import { DirectMixer, BLOCK_FRAMES, type MixBlock } from '../../src/host/directMixer'
import { OUTPUT_RATE } from '../../src/host/audioInput'
import type { SessionParams } from '../../shared/host'

/**
 * A recording can hold several audio tracks: the mix, the microphone alone and
 * everything else alone. The muxer holds one audio track, so each extra track is
 * a file of sound alone with its own encoder, and every track is laid on the same
 * timeline so they stay in step with the picture and with each other.
 */

const PARAMS: SessionParams = {
  width: 1280, height: 720, fps: 30, videoBitrate: 4_000_000, audioBitrate: 160_000,
  encoder: 'auto', keyframeSeconds: 2, audio: true, tracks: 3,
}

interface Run {
  encoders: Array<{ encodes: Array<{ timestampUs: number; frames: number; data: Float32Array }>; flushed: boolean; closed: boolean }>
  muxers: Array<{ options: MuxerOptions; audioChunks: number; finalized: boolean }>
  emitted: Array<{ track: number; bytes: number }>
  openAudio: number
}

async function make(over: Partial<SessionParams> = {}) {
  const run: Run = { encoders: [], muxers: [], emitted: [], openAudio: 0 }
  const deps: SessionDeps = {
    createVideoEncoder: () => ({ encodeQueueSize: 0, configure() {}, encode() {}, flush: async () => {}, close() {} }),
    createAudioEncoder: (init) => {
      const encoder = { encodes: [] as Run['encoders'][number]['encodes'], flushed: false, closed: false }
      run.encoders.push(encoder)
      return {
        encodeQueueSize: 0,
        configure() {},
        encode: (a) => { encoder.encodes.push(a as never); init.output({ type: 'key' }) },
        flush: async () => { encoder.flushed = true },
        close: () => { encoder.closed = true },
      }
    },
    videoSupported: async () => true,
    createMuxer: (options) => {
      const muxer = { options, audioChunks: 0, finalized: false }
      run.muxers.push(muxer)
      return {
        addVideoChunk() {},
        addAudioChunk: () => { muxer.audioChunks++ },
        finalize: () => { muxer.finalized = true; options.onData(new Uint8Array([1, 2, 3]), 0) },
      }
    },
    createVideoFrame: () => ({ close() {} }),
    createAudioData: (init) => { run.openAudio++; return { ...init, close: () => { run.openAudio-- } } as never },
  }
  const session = await EncoderSession.create({ ...PARAMS, ...over }, (d, track) => run.emitted.push({ track, bytes: d.byteLength }), deps)
  return { session, run }
}

const FRAMES = 1024
const planar = (left: number, right = left) => {
  const d = new Float32Array(FRAMES * 2)
  d.fill(left, 0, FRAMES)
  d.fill(right, FRAMES)
  return d
}

describe('setting up tracks', () => {
  it('has one encoder and muxer for one track', async () => {
    const { run } = await make({ tracks: 1 })
    expect(run.encoders).toHaveLength(1)
    expect(run.muxers).toHaveLength(1)
  })

  it('adds an encoder and a sound-only muxer for each extra track', async () => {
    const { run } = await make({ tracks: 3 })
    expect(run.encoders).toHaveLength(3)
    expect(run.muxers.map((m) => m.options.video)).toEqual([true, false, false])
    expect(run.muxers.every((m) => m.options.audio)).toBe(true)
  })

  it('never makes more than three tracks', async () => {
    const { run } = await make({ tracks: 9 })
    expect(run.encoders).toHaveLength(3)
  })

  it('makes no extra tracks for an output without sound', async () => {
    const { run } = await make({ tracks: 3, audio: false })
    expect(run.encoders).toHaveLength(0)
    expect(run.muxers).toHaveLength(1)
  })

  it('treats a missing track count as one', async () => {
    const { run } = await make({ tracks: undefined as never })
    expect(run.encoders).toHaveLength(1)
  })
})

describe('sound on each track', () => {
  it('sends each track its own sound', async () => {
    const { session, run } = await make()
    session.start(0)
    session.submitAudio(0, FRAMES, planar(0.5), [planar(0.25), planar(0.125)])

    expect(run.encoders[0].encodes[0].data[0]).toBe(0.5)
    expect(run.encoders[1].encodes[0].data[0]).toBe(0.25)
    expect(run.encoders[2].encodes[0].data[0]).toBe(0.125)
  })

  it('puts every track at the same time', async () => {
    const { session, run } = await make()
    session.start(1000)
    session.submitAudio(1000, FRAMES, planar(0.5), [planar(0.25), planar(0.125)])
    session.submitAudio(1000 + (FRAMES / SAMPLE_RATE) * 1000, FRAMES, planar(0.5), [planar(0.25), planar(0.125)])

    const stamps = run.encoders.map((e) => e.encodes.map((x) => x.timestampUs))
    expect(stamps[1]).toEqual(stamps[0])
    expect(stamps[2]).toEqual(stamps[0])
  })

  it('fills a stall with silence on every track', async () => {
    const { session, run } = await make()
    session.start(0)
    session.submitAudio(0, FRAMES, planar(0.5), [planar(0.5), planar(0.5)])
    session.submitAudio(500, FRAMES, planar(0.5), [planar(0.5), planar(0.5)])

    const lengths = run.encoders.map((e) => e.encodes.reduce((n, x) => n + x.frames, 0))
    expect(lengths[1]).toBe(lengths[0])
    expect(lengths[2]).toBe(lengths[0])
  })

  it('trims an overlapping block the same on every track, left and right alike', async () => {
    const { session, run } = await make()
    session.start(0)
    session.submitAudio(0, FRAMES, planar(0.5), [planar(0.5), planar(0.5)])
    // Arrives 30 ms early, beyond the tolerance, so it overlaps what has been laid.
    session.submitAudio((FRAMES / SAMPLE_RATE) * 1000 - 30, FRAMES, planar(0.5), [planar(0.5), planar(0.5)])

    const counts = run.encoders.map((e) => e.encodes.reduce((n, x) => n + x.frames, 0))
    expect(counts[0]).toBeLessThan(2 * FRAMES)
    expect(counts[1]).toBe(counts[0])
    for (const e of run.encoders) for (const x of e.encodes) expect(x.data.length).toBe(x.frames * 2)
  })

  it('gives silence to an extra track that was not supplied', async () => {
    const { session, run } = await make({ tracks: 2 })
    session.start(0)
    session.submitAudio(0, FRAMES, planar(0.5))

    expect(run.encoders[1].encodes[0].data.every((v) => v === 0)).toBe(true)
  })

  it('starts each extra track at zero even when the first sound comes later', async () => {
    const { session, run } = await make()
    session.start(1000)
    session.submitAudio(1300, FRAMES, planar(0.5), [planar(0.25), planar(0.125)])

    for (const e of run.encoders.slice(1)) {
      expect(e.encodes[0].timestampUs).toBe(0)
      const lead = e.encodes.slice(0, -1).reduce((n, x) => n + x.frames, 0)
      expect(lead).toBe(Math.round(0.3 * SAMPLE_RATE))
      expect(e.encodes.at(-1)!.timestampUs).toBe(300_000)
    }
  })

  it('closes every block of audio it made, on every track', async () => {
    const { session, run } = await make()
    session.start(0)
    for (let i = 0; i < 5; i++) session.submitAudio(i * 21.333, FRAMES, planar(0.1), [planar(0.1), planar(0.1)])
    expect(run.openAudio).toBe(0)
  })
})

describe('where each track goes', () => {
  it('tags what each muxer writes with its track', async () => {
    const { session, run } = await make()
    await session.stop()
    expect(run.emitted.map((e) => e.track).sort()).toEqual([0, 1, 2])
  })

  it('finishes every file and closes every encoder', async () => {
    const { session, run } = await make()
    session.start(0)
    await session.stop()

    expect(run.muxers.every((m) => m.finalized)).toBe(true)
    expect(run.encoders.every((e) => e.flushed && e.closed)).toBe(true)
  })

  it('closes every encoder when abandoned', async () => {
    const { session, run } = await make()
    session.abort()
    expect(run.encoders.every((e) => e.closed)).toBe(true)
  })
})

describe('separating the sound in the mixer', () => {
  function mixerWith() {
    const blocks: MixBlock[] = []
    let now = 5000
    const mixer = new DirectMixer({ now: () => now, onBlock: (b) => blocks.push(b) })
    const feed = (handle: ReturnType<DirectMixer['addInput']>, value: number) => {
      for (let t = 0; t < 200; t += 10) {
        handle.push({
          timestampUs: (now + t) * 1000, sampleRate: OUTPUT_RATE,
          channels: [new Float32Array(Math.round((10 * OUTPUT_RATE) / 1000)).fill(value)],
        }, now + t + 15)
      }
    }
    const run = () => { for (let i = 0; i < 40; i++) { now += 10; mixer.pump() } }
    return { mixer, blocks, feed, run }
  }

  it('keeps the microphone apart from everything else', () => {
    const { mixer, blocks, feed, run } = mixerWith()
    feed(mixer.addInput('mic1', OUTPUT_RATE, 'mic'), 0.3)
    feed(mixer.addInput('desktop', OUTPUT_RATE, 'other'), 0.1)
    run()

    const b = blocks.find((x) => x.data[100] !== 0)!
    expect(b.mic[100]).toBeCloseTo(0.3)
    expect(b.other[100]).toBeCloseTo(0.1)
    expect(b.data[100]).toBeCloseTo(0.4)
  })

  it('puts an input in the other group unless told otherwise', () => {
    const { mixer, blocks, feed, run } = mixerWith()
    feed(mixer.addInput('media:a'), 0.2)
    run()

    const b = blocks.find((x) => x.data[100] !== 0)!
    expect(b.other[100]).toBeCloseTo(0.2)
    expect(b.mic[100]).toBe(0)
  })

  it('applies the fader to its own track', () => {
    const { mixer, blocks, feed, run } = mixerWith()
    const mic = mixer.addInput('mic1', OUTPUT_RATE, 'mic')
    mic.setGain(0.5)
    feed(mic, 0.4)
    run()

    const b = blocks.find((x) => x.data[100] !== 0)!
    expect(b.mic[100]).toBeCloseTo(0.2)
  })

  it('clips each track on its own', () => {
    const { mixer, blocks, feed, run } = mixerWith()
    feed(mixer.addInput('mic1', OUTPUT_RATE, 'mic'), 0.9)
    feed(mixer.addInput('mic2', OUTPUT_RATE, 'mic'), 0.9)
    feed(mixer.addInput('desktop', OUTPUT_RATE, 'other'), 0.9)
    run()

    const b = blocks.find((x) => x.data[100] !== 0)!
    expect(b.mic[100]).toBe(1)
    expect(b.other[100]).toBeCloseTo(0.9)
    expect(b.data[100]).toBe(1)
  })

  it('gives silent extra tracks when nothing is connected', () => {
    const { blocks, run } = mixerWith()
    run()
    expect(blocks.length).toBeGreaterThan(0)
    for (const b of blocks) {
      expect(b.mic.length).toBe(BLOCK_FRAMES * 2)
      expect(b.other.length).toBe(BLOCK_FRAMES * 2)
      expect([...b.mic, ...b.other].every((v) => v === 0)).toBe(true)
    }
  })
})
