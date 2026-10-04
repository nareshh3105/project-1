import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  EncoderSession, h264Codec, MAX_ENCODE_QUEUE, WARMUP_MS, queueLimit, SAMPLE_RATE, type SessionDeps, type MuxerOptions,
} from '../../src/host/session'
import type { SessionParams } from '../../shared/host'

/**
 * The session is where timing and back-pressure live: frames stamped from the
 * wall clock, audio laid end to end, a frame dropped rather than latency growing,
 * and every frame and block of audio closed after encoding (an unclosed AudioData
 * once silenced a recording after seven minutes).
 */

const PARAMS: SessionParams = {
  width: 1920, height: 1080, fps: 30, videoBitrate: 6_000_000, audioBitrate: 160_000,
  encoder: 'auto', keyframeSeconds: 2, audio: true,
}

interface Encoded { timestampUs: number; frames?: number; data?: Float32Array }

let videoEncodes: Array<{ ts: number; key: boolean }>
let audioEncodes: Encoded[]
let videoConfig: Record<string, unknown> | null
let audioConfig: Record<string, unknown> | null
let queueSize: number
let closedFrames: number
let openFrames: number
let closedAudio: number
let openAudio: number
let muxerOptions: MuxerOptions
let muxLog: string[]
let supported: (c: Record<string, unknown>) => boolean
let videoInit: { output: (c: { type: 'key' | 'delta' }, m?: unknown) => void; error: (e: unknown) => void }
let audioInit: { output: (c: { type: 'key' | 'delta' }, m?: unknown) => void; error: (e: unknown) => void }
let flushOrder: string[]
let emitted: ArrayBuffer[]

const deps = (): SessionDeps => ({
  createVideoEncoder: (init) => {
    videoInit = init
    return {
      get encodeQueueSize() { return queueSize },
      configure: (c) => { videoConfig = c as Record<string, unknown> },
      encode: (f, o) => { videoEncodes.push({ ts: (f as { ts: number }).ts, key: !!o?.keyFrame }) },
      flush: async () => { flushOrder.push('video') },
      close: () => { muxLog.push('closeVideo') },
    }
  },
  createAudioEncoder: (init) => {
    audioInit = init
    return {
      encodeQueueSize: 0,
      configure: (c) => { audioConfig = c as Record<string, unknown> },
      encode: (a) => { audioEncodes.push(a as Encoded) },
      flush: async () => { flushOrder.push('audio') },
      close: () => { muxLog.push('closeAudio') },
    }
  },
  videoSupported: async (c) => supported(c),
  createMuxer: (o) => {
    muxerOptions = o
    return {
      addVideoChunk: () => { muxLog.push('video') },
      addAudioChunk: () => { muxLog.push('audio') },
      finalize: () => { muxLog.push('finalize') },
    }
  },
  createVideoFrame: (_src, ts) => { openFrames++; return { ts, close: () => { closedFrames++; openFrames-- } } as never },
  createAudioData: (init) => {
    openAudio++
    return { ...init, close: () => { closedAudio++; openAudio-- } } as never
  },
})

const settle = () => new Promise((r) => setTimeout(r, 0))

async function make(over: Partial<SessionParams> = {}) {
  const s = await EncoderSession.create({ ...PARAMS, ...over }, (d) => emitted.push(d), deps())
  return s
}

/** A planar stereo block whose samples say where they were in the block. */
const block = (frames: number) => {
  const d = new Float32Array(frames * 2)
  for (let i = 0; i < frames; i++) { d[i] = i; d[frames + i] = -i }
  return d
}

beforeEach(() => {
  videoEncodes = []; audioEncodes = []; videoConfig = null; audioConfig = null
  queueSize = 0; closedFrames = 0; openFrames = 0; closedAudio = 0; openAudio = 0
  muxLog = []; flushOrder = []; emitted = []
  supported = () => true
})

describe('choosing a codec level', () => {
  it.each([
    [1280, 720, 30, 'avc1.640028'],
    [1920, 1080, 30, 'avc1.640028'],
    [1920, 1080, 60, 'avc1.64002A'],
    [2560, 1440, 30, 'avc1.64002A'],
    [3840, 2160, 30, 'avc1.640033'],
    [2560, 1440, 60, 'avc1.640033'],
  ])('%sx%s at %s fps uses %s', (w, h, fps, codec) => {
    expect(h264Codec(w, h, fps)).toBe(codec)
  })
})

describe('setting up', () => {
  it('asks for H.264 in the container\'s sample format, realtime', async () => {
    await make()
    expect(videoConfig).toMatchObject({
      codec: 'avc1.640028', width: 1920, height: 1080, bitrate: 6_000_000, framerate: 30,
      latencyMode: 'realtime', avc: { format: 'avc' },
    })
  })

  it('asks for Opus at the chosen bitrate', async () => {
    await make({ audioBitrate: 128_000 })
    expect(audioConfig).toMatchObject({ codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 128_000 })
  })

  it('prefers hardware, and says so', async () => {
    const s = await make()
    expect(videoConfig?.hardwareAcceleration).toBe('prefer-hardware')
    expect(s.stats().hardware).toBe(true)
  })

  it('falls back to software when there is no hardware encoder', async () => {
    supported = (c) => c.hardwareAcceleration === 'prefer-software'
    const s = await make()

    expect(videoConfig?.hardwareAcceleration).toBe('prefer-software')
    expect(s.stats().hardware).toBe(false)
  })

  it('never falls back when hardware was demanded', async () => {
    supported = (c) => c.hardwareAcceleration === 'prefer-software'
    await expect(make({ encoder: 'hardware' })).rejects.toThrow(/no hardware video encoder/)
  })

  it('uses software only when asked', async () => {
    const tried: unknown[] = []
    supported = (c) => { tried.push(c.hardwareAcceleration); return true }
    await make({ encoder: 'software' })
    expect(tried).toEqual(['prefer-software'])
  })

  it('says plainly when nothing can encode the size', async () => {
    supported = () => false
    await expect(make({ width: 7680, height: 4320, fps: 60 })).rejects.toThrow('cannot encode 7680x4320 at 60 fps')
  })

  it('has no audio track or encoder for a silent output', async () => {
    await make({ audio: false })
    expect(muxerOptions.audio).toBe(false)
    expect(audioConfig).toBeNull()
  })

  it('hands the muxer\'s output on as a copy it owns', async () => {
    await make()
    const shared = new Uint8Array([1, 2, 3, 4])
    muxerOptions.onData(shared, 0)
    shared.fill(9) // the muxer reuses its buffer

    expect(Array.from(new Uint8Array(emitted[0]))).toEqual([1, 2, 3, 4])
  })
})

describe('video', () => {
  it('ignores frames before it is started', async () => {
    const s = await make()
    s.submitFrame({}, 1000)
    expect(videoEncodes).toEqual([])
  })

  it('stamps frames from the wall clock, in microseconds from the start', async () => {
    const s = await make()
    s.start(10_000)
    s.submitFrame({}, 10_000)
    s.submitFrame({}, 10_033.333)
    s.submitFrame({}, 11_500)

    expect(videoEncodes.map((v) => v.ts)).toEqual([0, 33_333, 1_500_000])
  })

  it('never stamps a frame before zero', async () => {
    const s = await make()
    s.start(10_000)
    s.submitFrame({}, 9_990)
    expect(videoEncodes[0].ts).toBe(0)
  })

  it('asks for a keyframe at the start and then on schedule', async () => {
    const s = await make({ fps: 30, keyframeSeconds: 2 })
    s.start(0)
    for (let i = 0; i < 125; i++) s.submitFrame({}, i * 33)

    const keys = videoEncodes.map((v, i) => (v.key ? i : -1)).filter((i) => i >= 0)
    expect(keys).toEqual([0, 60, 120])
  })

  it('keeps asking for a keyframe every whole second count even at odd rates', async () => {
    const s = await make({ fps: 24, keyframeSeconds: 1 })
    s.start(0)
    for (let i = 0; i < 50; i++) s.submitFrame({}, i * 41)
    expect(videoEncodes.filter((v) => v.key)).toHaveLength(3)
  })

  it('closes every frame it created', async () => {
    const s = await make()
    s.start(0)
    for (let i = 0; i < 100; i++) s.submitFrame({}, i * 33)

    expect(closedFrames).toBe(100)
    expect(openFrames).toBe(0)
  })

  it('closes the frame even if the encoder refuses it', async () => {
    const s = await make()
    s.start(0)
    const d = deps()
    // Make this session's encoder throw.
    ;(s as unknown as { videoEncoder: { encode: () => void } }).videoEncoder.encode = () => { throw new Error('closed codec') }
    expect(() => s.submitFrame({}, 0)).toThrow('closed codec')
    expect(openFrames).toBe(0)
    void d
  })

  describe('when the encoder falls behind', () => {
    const SETTLED = 10_000 // well past the warm-up

    it('drops frames rather than let the queue grow', async () => {
      const s = await make()
      s.start(0)
      queueSize = MAX_ENCODE_QUEUE + 1
      s.submitFrame({}, SETTLED)
      s.submitFrame({}, SETTLED + 33)

      expect(videoEncodes).toEqual([])
      expect(s.stats().framesDropped).toBe(2)
      expect(s.stats().framesIn).toBe(2)
    })

    it('tolerates a queue right at the limit, so brief hiccups cost nothing', async () => {
      const s = await make()
      s.start(0)
      queueSize = MAX_ENCODE_QUEUE
      s.submitFrame({}, SETTLED)

      expect(videoEncodes).toHaveLength(1)
      expect(s.stats().framesDropped).toBe(0)
    })

    it('resumes as soon as the queue drains', async () => {
      const s = await make()
      s.start(0)
      queueSize = 99
      s.submitFrame({}, SETTLED)
      queueSize = 0
      s.submitFrame({}, SETTLED + 33)

      expect(videoEncodes).toHaveLength(1)
    })

    it('still asks for the opening keyframe if the first frame was dropped', async () => {
      const s = await make()
      s.start(0)
      queueSize = 99
      s.submitFrame({}, SETTLED)
      queueSize = 0
      s.submitFrame({}, SETTLED + 33)

      expect(videoEncodes[0].key).toBe(true)
    })

    // A hardware encoder takes a moment to start. The opening of a recording
    // must not be thrown away while it does (30 frames were lost at 1080p60).
    it('lets frames wait while the encoder is still starting up', async () => {
      const s = await make()
      s.start(0)
      queueSize = MAX_ENCODE_QUEUE + 20
      s.submitFrame({}, 100)

      expect(videoEncodes).toHaveLength(1)
      expect(s.stats().framesDropped).toBe(0)
    })

    it('still drops, even in the opening seconds, if the queue grows without end', async () => {
      const s = await make()
      s.start(0)
      queueSize = 500
      s.submitFrame({}, 100)
      expect(s.stats().framesDropped).toBe(1)
    })

    it('stops being generous once the warm-up is over', async () => {
      const s = await make()
      s.start(0)
      queueSize = MAX_ENCODE_QUEUE + 20
      s.submitFrame({}, WARMUP_MS - 1)
      s.submitFrame({}, WARMUP_MS + 1)

      expect(videoEncodes).toHaveLength(1)
      expect(s.stats().framesDropped).toBe(1)
    })
  })
})

describe('the allowance for a queue', () => {
  it.each([
    [30, 10_000, 30], [60, 10_000, 45], [120, 10_000, 90], [5, 10_000, 30],
    [30, 0, 60], [60, 0, 120], [24, 1999, 48],
  ])('at %s fps, %s ms in, allows %s frames', (fps, since, expected) => {
    expect(queueLimit(fps, since)).toBe(expected)
  })

  it('never allows fewer than the minimum', () => {
    expect(queueLimit(1, 99_999)).toBe(MAX_ENCODE_QUEUE)
  })
})

describe('audio', () => {
  const BLOCK = 1024
  const BLOCK_MS = (BLOCK / SAMPLE_RATE) * 1000

  it('ignores audio before it is started', async () => {
    const s = await make()
    s.submitAudio(0, BLOCK, block(BLOCK))
    expect(audioEncodes).toEqual([])
  })

  it('does nothing for an output with no audio', async () => {
    const s = await make({ audio: false })
    s.start(0)
    s.submitAudio(0, BLOCK, block(BLOCK))
    expect(audioEncodes).toEqual([])
  })

  it('ignores audio that ended before the recording began', async () => {
    const s = await make()
    s.start(5000)
    s.submitAudio(4000, BLOCK, block(BLOCK))
    expect(audioEncodes).toEqual([])
  })

  it('stamps the first block from the wall clock, relative to the start', async () => {
    const s = await make()
    s.start(1000)
    s.submitAudio(1250, BLOCK, block(BLOCK))

    expect(audioEncodes[0].timestampUs).toBe(250_000)
  })

  it('lays blocks end to end, however they wobble', async () => {
    const s = await make()
    s.start(0)
    s.submitAudio(0, BLOCK, block(BLOCK))
    s.submitAudio(BLOCK_MS + 6, BLOCK, block(BLOCK))
    s.submitAudio(2 * BLOCK_MS - 4, BLOCK, block(BLOCK))

    const at = (n: number) => Math.round(((n * BLOCK) / SAMPLE_RATE) * 1e6)
    expect(audioEncodes.map((a) => a.timestampUs)).toEqual([0, at(1), at(2)])
  })

  it('passes the samples through untouched when nothing needs correcting', async () => {
    const s = await make()
    s.start(0)
    const data = block(BLOCK)
    s.submitAudio(0, BLOCK, data)

    expect(audioEncodes[0].data).toBe(data)
    expect(audioEncodes[0].frames).toBe(BLOCK)
  })

  it('fills a stall with silence so later audio stays in sync', async () => {
    const s = await make()
    s.start(0)
    s.submitAudio(0, BLOCK, block(BLOCK))
    s.submitAudio(BLOCK_MS + 500, BLOCK, block(BLOCK))

    const silence = audioEncodes.slice(1, -1)
    expect(silence.length).toBeGreaterThan(0)
    expect(silence.every((a) => a.data!.every((v) => v === 0))).toBe(true)

    // Silence plus audio account for the whole stretch, with no gap and no overlap.
    let at = audioEncodes[0].timestampUs + (BLOCK / SAMPLE_RATE) * 1e6
    for (const a of audioEncodes.slice(1)) {
      expect(a.timestampUs).toBeCloseTo(at, -1)
      at += (a.frames! / SAMPLE_RATE) * 1e6
    }
    expect(s.stats().silenceFrames).toBeGreaterThan(0)
  })

  it('fills a very long stall in pieces, not one huge buffer', async () => {
    const s = await make()
    s.start(0)
    s.submitAudio(0, BLOCK, block(BLOCK))
    s.submitAudio(10_000, BLOCK, block(BLOCK))

    expect(Math.max(...audioEncodes.map((a) => a.frames!))).toBeLessThanOrEqual(SAMPLE_RATE)
  })

  it('trims the front of a block that arrives overlapping, keeping both channels aligned', async () => {
    const s = await make()
    s.start(0)
    const big = 4800 // 100 ms, so an overlap beyond the tolerance still leaves audio to keep
    s.submitAudio(0, big, block(big))
    s.submitAudio(100 - 50, big, block(big))

    const second = audioEncodes[1]
    const skipped = big - second.frames!
    expect(skipped).toBeGreaterThan(0)
    // Left channel starts where the skip ended; right channel likewise.
    expect(second.data![0]).toBe(skipped)
    expect(second.data![second.frames!]).toBe(-skipped)
    expect(second.data).toHaveLength(second.frames! * 2)
    expect(s.stats().trimmedFrames).toBe(skipped)
  })

  it('closes every block of audio it created', async () => {
    const s = await make()
    s.start(0)
    for (let i = 0; i < 200; i++) s.submitAudio(i * BLOCK_MS, BLOCK, block(BLOCK))
    s.submitAudio(200 * BLOCK_MS + 400, BLOCK, block(BLOCK)) // forces silence too

    expect(openAudio).toBe(0)
    expect(closedAudio).toBe(audioEncodes.length)
  })

  it('closes the audio even if the encoder refuses it', async () => {
    const s = await make()
    s.start(0)
    ;(s as unknown as { audioEncoder: { encode: () => void } }).audioEncoder.encode = () => { throw new Error('closed codec') }
    expect(() => s.submitAudio(0, BLOCK, block(BLOCK))).toThrow()
    expect(openAudio).toBe(0)
  })
})

describe('finishing', () => {
  it('flushes both encoders before closing the container', async () => {
    const s = await make()
    s.start(0)
    muxLog.length = 0
    await s.stop()

    expect(flushOrder).toEqual(['video', 'audio'])
    expect(muxLog.indexOf('finalize')).toBeGreaterThanOrEqual(0)
    expect(muxLog.indexOf('finalize')).toBeLessThan(muxLog.indexOf('closeVideo'))
  })

  it('stops taking frames and audio', async () => {
    const s = await make()
    s.start(0)
    await s.stop()
    s.submitFrame({}, 100)
    s.submitAudio(100, 1024, block(1024))

    expect(videoEncodes).toEqual([])
    expect(audioEncodes).toEqual([])
  })

  it('can be stopped twice', async () => {
    const s = await make()
    s.start(0)
    await s.stop()
    await s.stop()
    expect(muxLog.filter((m) => m === 'finalize')).toHaveLength(1)
  })

  it('releases the encoders even if finishing fails', async () => {
    const s = await make()
    s.start(0)
    ;(s as unknown as { muxer: { finalize: () => void } }).muxer.finalize = () => { throw new Error('boom') }

    await expect(s.stop()).rejects.toThrow('boom')
    expect(muxLog).toContain('closeVideo')
    expect(muxLog).toContain('closeAudio')
  })

  it('abort releases the encoders without finishing the file', async () => {
    const s = await make()
    s.start(0)
    s.abort()

    expect(muxLog).not.toContain('finalize')
    expect(muxLog).toContain('closeVideo')
    expect(muxLog).toContain('closeAudio')
  })

  it('survives closing an encoder that is already closed', async () => {
    const s = await make()
    ;(s as unknown as { videoEncoder: { close: () => void } }).videoEncoder.close = () => { throw new Error('already closed') }
    expect(() => s.abort()).not.toThrow()
  })
})

describe('encoder failure', () => {
  it('reports it and stops taking input', async () => {
    const s = await make()
    const messages: string[] = []
    s.onError = (m) => messages.push(m)
    s.start(0)

    videoInit.error(new Error('Encoder overloaded'))
    s.submitFrame({}, 33)

    expect(messages).toEqual(['video: Encoder overloaded'])
    expect(s.failure).toBe('video: Encoder overloaded')
    expect(videoEncodes).toEqual([])
  })

  it('reports an audio failure too', async () => {
    const s = await make()
    const messages: string[] = []
    s.onError = (m) => messages.push(m)
    s.start(0)
    audioInit.error('device lost')
    expect(messages).toEqual(['audio: device lost'])
  })

  it('says nothing about errors that arrive while shutting down', async () => {
    const s = await make()
    const messages: string[] = []
    s.onError = (m) => messages.push(m)
    s.start(0)
    await s.stop()

    videoInit.error(new Error('closed'))
    expect(messages).toEqual([])
  })
})

describe('chunks', () => {
  it('counts what the encoders produce and passes it to the container', async () => {
    const s = await make()
    s.start(0)
    muxLog.length = 0

    videoInit.output({ type: 'key' })
    videoInit.output({ type: 'delta' })
    audioInit.output({ type: 'key' })

    expect(muxLog).toEqual(['video', 'video', 'audio'])
    expect(s.stats()).toMatchObject({ videoChunks: 2, keyframes: 1, audioChunks: 1 })
  })
})

describe('timing under pressure', () => {
  it('keeps video steady through a long run with the occasional stall', async () => {
    const s = await make()
    s.start(0)
    let t = 0
    for (let i = 0; i < 3000; i++) {
      queueSize = i % 500 === 499 ? MAX_ENCODE_QUEUE + 5 : 0 // a stall now and then
      t += 33.3
      s.submitFrame({}, t)
      if (i % 500 === 499) await settle()
    }
    const stats = s.stats()
    expect(stats.framesDropped).toBe(6)
    expect(stats.framesIn - stats.framesDropped).toBe(videoEncodes.length)
    expect(openFrames).toBe(0)
  })
})

void vi
