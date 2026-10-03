import { describe, it, expect, beforeEach, vi } from 'vitest'
import { HostApp, type AudioBlock, type AudioRig, type HostDeps } from '../../src/host/hostApp'
import { HOST_CHANNELS, type HostSnapshot, type SessionParams, type SnapshotSource } from '../../shared/host'

/**
 * The host is the part nobody can see, so its lifecycle has to be exact: it
 * holds no capture or microphone while idle, answers every request, ends an
 * output cleanly, and reports a failure instead of going quiet.
 */

const PARAMS: SessionParams = {
  width: 1280, height: 720, fps: 30, videoBitrate: 4_000_000, audioBitrate: 128_000,
  encoder: 'auto', keyframeSeconds: 2, audio: true,
}

const src = (id: string, order = 0): SnapshotSource => ({
  id, type: 'display_capture', order,
  transform: { x: 0, y: 0, width: 1920, height: 1080, rotation: 0, scaleX: 1, scaleY: 1 },
  target: { kind: 'screen', id: 'screen:0:0', name: 'Entire screen' },
})
const snap = (over: Partial<HostSnapshot> = {}): HostSnapshot => ({
  base: { width: 1920, height: 1080 },
  sources: [src('a')],
  audio: [{ id: 'mic', volume: 1, muted: false, noiseSuppression: false, connected: true }],
  ...over,
})

type Handler = (...a: unknown[]) => void

let sent: Array<{ channel: string; args: unknown[] }>
let handlers: Record<string, Handler>
let encoded: { frames: number; audio: number; closed: number; flushed: number; aborted: number }
let encoderFails: ((m: unknown) => void) | null
let opens: number
let audioRigs: Array<{ applied: unknown[]; disposed: boolean; emit: (b: AudioBlock) => void; rig: AudioRig }>
let onBlock: (b: AudioBlock) => void
let app: HostApp
let tick: () => void
let timers: number
let createAudioFails: boolean
let encoderSupported: boolean
let drawn: number
let clockMs: number

const settle = () => new Promise((r) => setTimeout(r, 0))
const request = async (id: number, method: string, args?: unknown) => {
  handlers[HOST_CHANNELS.request]({ id, method, args })
  await settle()
  await settle()
  return sent.filter((s) => s.channel === HOST_CHANNELS.response).map((s) => s.args[0] as { id: number; ok: boolean; error?: string }).find((r) => r.id === id)!
}
const pushState = (s: HostSnapshot) => handlers[HOST_CHANNELS.state](s)

function build(): HostDeps {
  return {
    bridge: {
      send: (channel, ...args) => { sent.push({ channel, args }) },
      listen: (channel, cb) => { handlers[channel] = cb as Handler; return () => { delete handlers[channel] } },
    },
    session: {
      createVideoEncoder: (init) => {
        encoderFails = init.error
        return {
          encodeQueueSize: 0,
          configure: () => {},
          encode: () => { encoded.frames++ },
          flush: async () => { encoded.flushed++ },
          close: () => { encoded.closed++ },
        }
      },
      createAudioEncoder: () => ({
        encodeQueueSize: 0, configure: () => {}, encode: () => { encoded.audio++ },
        flush: async () => {}, close: () => { encoded.closed++ },
      }),
      videoSupported: async () => encoderSupported,
      createMuxer: ({ onData }) => ({
        addVideoChunk: () => {}, addAudioChunk: () => {},
        finalize: () => onData(new Uint8Array([1, 2, 3]), 0),
      }),
      createVideoFrame: () => ({ close: () => {} }),
      createAudioData: () => ({ close: () => {} }),
    },
    pool: {
      open: async () => { opens++; return { getTracks: () => [], getVideoTracks: () => [] } as unknown as MediaStream },
      createVideo: () => ({ srcObject: null, muted: false, readyState: 4, videoWidth: 1920, videoHeight: 1080, play: async () => {} }),
    },
    loop: {
      now: () => clockMs,
      setTimer: (cb) => { tick = cb; timers++; return timers },
      clearTimer: () => { timers = Math.max(0, timers - 1) },
    },
    now: () => 0,
    createCanvas: () => ({
      canvas: {},
      context: new Proxy({}, { get: () => () => { drawn++ }, set: () => true }) as unknown as CanvasRenderingContext2D,
    }),
    createAudio: async (cb) => {
      if (createAudioFails) throw new Error('No audio device.')
      onBlock = cb
      const rec = { applied: [] as unknown[], disposed: false, emit: cb, rig: null as unknown as AudioRig }
      rec.rig = { apply: (c) => { rec.applied.push(c) }, dispose: () => { rec.disposed = true }, toWallMs: (s) => s * 1000 }
      audioRigs.push(rec)
      return rec.rig
    },
  }
}

beforeEach(() => {
  sent = []; handlers = {}; clockMs = 0; opens = 0; audioRigs = []; timers = 0; drawn = 0
  encoded = { frames: 0, audio: 0, closed: 0, flushed: 0, aborted: 0 }
  encoderFails = null; createAudioFails = false; encoderSupported = true
  tick = () => {}
  app = new HostApp(build())
  app.start()
})

describe('starting up', () => {
  it('tells the main process it is ready', () => {
    expect(sent[0]).toEqual({ channel: HOST_CHANNELS.ready, args: [] })
  })

  it('answers a ping', async () => {
    expect(await request(1, 'ping')).toMatchObject({ ok: true })
  })

  it('refuses a request it does not know, rather than staying silent', async () => {
    const r = await request(2, 'selfDestruct')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/Unknown request/)
  })

  it('holds no capture or input while idle', async () => {
    pushState(snap())
    await settle()
    expect(opens).toBe(0)
    expect(audioRigs).toHaveLength(0)
  })
})

describe('opening an output', () => {
  it('starts captures, audio and drawing', async () => {
    pushState(snap())
    const r = await request(1, 'openSession', { kind: 'recording', params: PARAMS })

    expect(r.ok).toBe(true)
    expect(opens).toBe(1)
    expect(audioRigs).toHaveLength(1)
    expect(audioRigs[0].applied).toHaveLength(1)
    expect(app.active).toEqual(['recording'])
  })

  it('draws and encodes frames', async () => {
    pushState(snap())
    await request(1, 'openSession', { kind: 'recording', params: PARAMS })
    tick()

    expect(drawn).toBeGreaterThan(0)
    expect(encoded.frames).toBe(1)
  })

  it('uses the scene that was current when the output opened', async () => {
    pushState(snap({ sources: [src('a'), src('b')] }))
    await request(1, 'openSession', { kind: 'recording', params: PARAMS })
    expect(opens).toBe(2)
  })

  it('follows scene changes while running', async () => {
    pushState(snap())
    await request(1, 'openSession', { kind: 'recording', params: PARAMS })
    pushState(snap({ sources: [src('a'), src('b')] }))
    await settle()

    expect(opens).toBe(2)
  })

  it('applies mixer changes while running', async () => {
    pushState(snap())
    await request(1, 'openSession', { kind: 'recording', params: PARAMS })
    pushState(snap({ audio: [{ id: 'mic', volume: 0.2, muted: false, noiseSuppression: false, connected: true }] }))

    expect(audioRigs[0].applied).toHaveLength(2)
  })

  it('does not start audio for an output without any', async () => {
    pushState(snap())
    await request(1, 'openSession', { kind: 'virtualCamera', params: { ...PARAMS, audio: false } })
    expect(audioRigs).toHaveLength(0)
  })

  it('shares one audio mix between outputs', async () => {
    pushState(snap())
    await request(1, 'openSession', { kind: 'recording', params: PARAMS })
    await request(2, 'openSession', { kind: 'streaming', params: PARAMS })

    expect(audioRigs).toHaveLength(1)
    expect(app.active.sort()).toEqual(['recording', 'streaming'])
  })

  it('refuses to open the same output twice', async () => {
    pushState(snap())
    await request(1, 'openSession', { kind: 'recording', params: PARAMS })
    const r = await request(2, 'openSession', { kind: 'recording', params: PARAMS })

    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/already running/)
    expect(app.active).toEqual(['recording'])
  })

  it('refuses a request with nothing in it', async () => {
    const r = await request(1, 'openSession', {})
    expect(r.ok).toBe(false)
  })

  it('reports an encoder that cannot do the job, and leaves nothing running', async () => {
    pushState(snap())
    encoderSupported = false
    const r = await request(1, 'openSession', { kind: 'recording', params: PARAMS })

    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/cannot encode/)
    expect(app.active).toEqual([])
    expect(audioRigs[0].disposed).toBe(true)
    expect(opens).toBe(0)
  })

  it('reports audio that cannot start, and leaves nothing running', async () => {
    pushState(snap())
    createAudioFails = true
    const r = await request(1, 'openSession', { kind: 'recording', params: PARAMS })

    expect(r.ok).toBe(false)
    expect(r.error).toBe('No audio device.')
    expect(app.active).toEqual([])
  })
})

describe('feeding audio', () => {
  const block = (): AudioBlock => ({ startSec: 1, frames: 1024, data: new Float32Array(2048) })

  it('passes mixed audio to every output that has sound', async () => {
    pushState(snap())
    await request(1, 'openSession', { kind: 'recording', params: PARAMS })
    await request(2, 'openSession', { kind: 'virtualCamera', params: { ...PARAMS, audio: false } })
    onBlock(block())

    expect(encoded.audio).toBe(1)
  })

  it('ignores audio when nothing is running', async () => {
    pushState(snap())
    await request(1, 'openSession', { kind: 'recording', params: PARAMS })
    await request(2, 'closeSession', { kind: 'recording' })
    expect(() => onBlock(block())).not.toThrow()
  })
})

describe('closing an output', () => {
  it('finishes the file and sends its last bytes before replying', async () => {
    pushState(snap())
    await request(1, 'openSession', { kind: 'recording', params: PARAMS })
    const r = await request(2, 'closeSession', { kind: 'recording' })

    expect(r.ok).toBe(true)
    const ingestIndex = sent.findIndex((s) => s.channel === HOST_CHANNELS.ingest)
    const replyIndex = sent.findIndex((s) => s.channel === HOST_CHANNELS.response && (s.args[0] as { id: number }).id === 2)
    expect(ingestIndex).toBeGreaterThan(-1)
    expect(ingestIndex).toBeLessThan(replyIndex)
    expect(sent[ingestIndex].args[0]).toBe('recording')
  })

  it('stops drawing', async () => {
    pushState(snap())
    await request(1, 'openSession', { kind: 'recording', params: PARAMS })
    await request(2, 'closeSession', { kind: 'recording' })

    expect(timers).toBe(0)
    expect(app.active).toEqual([])
  })

  it('lets go of captures and audio when the last output ends', async () => {
    pushState(snap())
    await request(1, 'openSession', { kind: 'recording', params: PARAMS })
    await request(2, 'closeSession', { kind: 'recording' })

    expect(audioRigs[0].disposed).toBe(true)
  })

  it('keeps captures and audio while another output still runs', async () => {
    pushState(snap())
    await request(1, 'openSession', { kind: 'recording', params: PARAMS })
    await request(2, 'openSession', { kind: 'streaming', params: PARAMS })
    await request(3, 'closeSession', { kind: 'recording' })

    expect(audioRigs[0].disposed).toBe(false)
    expect(app.active).toEqual(['streaming'])
  })

  it('stops drawing the closed output while the others carry on', async () => {
    pushState(snap())
    await request(1, 'openSession', { kind: 'recording', params: PARAMS })
    await request(2, 'openSession', { kind: 'streaming', params: PARAMS })
    clockMs = 100
    drawn = 0
    tick()
    const drawnForTwo = drawn
    expect(encoded.frames).toBe(2)

    await request(3, 'closeSession', { kind: 'recording' })
    encoded.frames = 0
    clockMs = 200
    drawn = 0
    tick()

    // One output's worth of drawing, not two: a closed output is not composed for nothing.
    expect(encoded.frames).toBe(1)
    expect(drawn).toBe(drawnForTwo / 2)
  })

  it('treats closing something that is not running as done', async () => {
    const r = await request(1, 'closeSession', { kind: 'recording' })
    expect(r.ok).toBe(true)
  })

  it('can open again after closing', async () => {
    pushState(snap())
    await request(1, 'openSession', { kind: 'recording', params: PARAMS })
    await request(2, 'closeSession', { kind: 'recording' })
    const r = await request(3, 'openSession', { kind: 'recording', params: PARAMS })

    expect(r.ok).toBe(true)
    expect(audioRigs).toHaveLength(2)
  })

  it('ignores scene changes once idle', async () => {
    pushState(snap())
    await request(1, 'openSession', { kind: 'recording', params: PARAMS })
    await request(2, 'closeSession', { kind: 'recording' })
    const before = opens
    pushState(snap({ sources: [src('x'), src('y')] }))
    await settle()

    expect(opens).toBe(before)
  })
})

describe('failure while running', () => {
  it('tells the main process, and ends that output', async () => {
    pushState(snap())
    await request(1, 'openSession', { kind: 'recording', params: PARAMS })

    encoderFails!(new Error('Encoder overloaded'))

    const event = sent.find((s) => s.channel === HOST_CHANNELS.event)!.args[0]
    expect(event).toEqual({ type: 'sessionError', kind: 'recording', message: 'video: Encoder overloaded' })
    expect(app.active).toEqual([])
  })

  it('leaves the other outputs running', async () => {
    pushState(snap())
    await request(1, 'openSession', { kind: 'streaming', params: PARAMS })
    let failRecording!: (m: unknown) => void
    // The next encoder created belongs to the recording.
    await request(2, 'openSession', { kind: 'recording', params: PARAMS })
    failRecording = encoderFails!
    failRecording(new Error('boom'))

    expect(app.active).toEqual(['streaming'])
    expect(audioRigs[0].disposed).toBe(false)
  })

  it('reports a drawing failure rather than going silent', async () => {
    pushState(snap())
    await request(1, 'openSession', { kind: 'recording', params: PARAMS })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    // Break the next draw by corrupting the scene so layers throw.
    pushState({ ...snap(), sources: [{ ...src('a'), transform: null as never }] })
    tick()
    spy.mockRestore()

    const event = sent.find((s) => s.channel === HOST_CHANNELS.event)?.args[0] as { type: string; message: string } | undefined
    expect(event?.type).toBe('sessionError')
    expect(event?.message).toMatch(/drawing failed/)
  })
})

describe('shutting down', () => {
  it('stops everything and stops listening', async () => {
    pushState(snap())
    await request(1, 'openSession', { kind: 'recording', params: PARAMS })
    app.dispose()

    expect(app.active).toEqual([])
    expect(audioRigs[0].disposed).toBe(true)
    expect(handlers[HOST_CHANNELS.request]).toBeUndefined()
  })
})
