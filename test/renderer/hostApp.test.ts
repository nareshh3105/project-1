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
  id, type: 'display_capture', order, settings: {}, filters: [],
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
let filterDefs: string[]
let filtersSet: string[]
let mediaVideos: Array<{ src: string }>
let browserAttached: string[]
let browserDetached: string[]
let pushPage: (id: string, update: { width: number; height: number; x: number; y: number; w: number; h: number; bgra: Uint8Array }) => void
let streamsAttached: Array<{ id: string; gain: number; detached: boolean }>
let drawImages: unknown[][]
let ctxCalls: unknown[][]
let clockMs: number
let wallMs: number

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
    setFilterDefs: (markup) => { filterDefs.push(markup) },
    browser: {
      attach: async (id) => { browserAttached.push(id) },
      detach: (id) => { browserDetached.push(id) },
      onFrame: (cb) => { pushPage = cb; return () => {} },
      onFailure: () => () => {},
      createSurface: (w, h) => ({ canvas: {} as CanvasImageSource, width: w, height: h, draw: () => {} }),
    },
    media: {
      resolveUrl: async (p) => `cbmedia://media/${p}`,
      createVideo: () => {
        const v = {
          src: '', loop: false, muted: false, crossOrigin: null as string | null,
          readyState: 4, videoWidth: 1280, videoHeight: 720, error: null,
          play: async () => {}, pause: () => {}, removeAttribute: () => {}, load: () => {},
          captureStream: () => ({ getTracks: () => [{ stop: () => {} }] }) as unknown as MediaStream,
          addEventListener: () => {},
        }
        mediaVideos.push(v)
        return v
      },
    },
    statics: {
      createCanvas: () => ({
        canvas: {} as CanvasImageSource,
        context: new Proxy({}, { get: () => () => ({ width: 0 }), set: () => true }) as never,
      }),
      loadImage: async () => ({ image: {} as CanvasImageSource, width: 10, height: 10 }),
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
    wallNow: () => wallMs,
    createCanvas: () => ({
      canvas: {},
      context: new Proxy({}, {
        get: (_t, key) => (...args: unknown[]) => { drawn++; ctxCalls.push([String(key), ...args]); if (key === 'drawImage') drawImages.push(args) },
        set: (_t, key, value) => { if (key === 'filter') filtersSet.push(String(value)); if (key === 'globalAlpha') ctxCalls.push(['globalAlpha', value]); return true },
      }) as unknown as CanvasRenderingContext2D,
    }),
    createAudio: async (cb) => {
      if (createAudioFails) throw new Error('No audio device.')
      onBlock = cb
      const rec = { applied: [] as unknown[], disposed: false, emit: cb, rig: null as unknown as AudioRig }
      rec.rig = {
        apply: (c) => { rec.applied.push(c) },
        dispose: () => { rec.disposed = true },
        toWallMs: (s) => s * 1000,
        attachStream: (id) => {
          const entry = { id, gain: 1, detached: false }
          streamsAttached.push(entry)
          return { setGain: (g) => { entry.gain = g }, detach: () => { entry.detached = true } }
        },
      }
      audioRigs.push(rec)
      return rec.rig
    },
  }
}

beforeEach(() => {
  sent = []; handlers = {}; filterDefs = []; filtersSet = []; mediaVideos = []; browserAttached = []; browserDetached = []; streamsAttached = []; drawImages = []; ctxCalls = []; clockMs = 0; wallMs = 0; opens = 0; audioRigs = []; timers = 0; drawn = 0
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

  it('draws color, text and image sources without opening any capture', async () => {
    const staticSource = (id: string, type: string): SnapshotSource => ({ ...src(id), type, target: null, settings: { color: '#ff0000' } })
    pushState(snap({ sources: [staticSource('c', 'color_source'), staticSource('t', 'text_gdi_plus')] }))
    await request(1, 'openSession', { kind: 'recording', params: PARAMS })
    tick()

    expect(opens).toBe(0)
    expect(encoded.frames).toBe(1)
    expect(drawn).toBeGreaterThan(0)
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

describe('filters', () => {
  const filtered = (id: string, filters: SnapshotSource['filters']): SnapshotSource => ({ ...src(id), filters })
  const blur = { id: 'f1', type: 'blur' as const, radius: 10 }
  const key = { id: 'k1', type: 'chroma-key' as const, keyColor: '#00ff00', similarity: 80, smoothness: 50, opacity: 1 }

  it('draws a filtered source with its filter', async () => {
    pushState(snap({ sources: [filtered('a', [blur])] }))
    await request(1, 'openSession', { kind: 'recording', params: PARAMS })
    tick()
    // 1280 wide output of a 1920 canvas: blur shrinks with the picture.
    expect(filtersSet).toContain('blur(6.6667px)')
  })

  it('fits a cropped source by what is left of it, not by its whole picture', async () => {
    // The fake capture is 1920 x 1080; half of it is cropped away and the box is 1920 x 1080.
    pushState(snap({ sources: [filtered('a', [{ id: 'c', type: 'crop', left: 960, right: 0, top: 0, bottom: 0 }])] }))
    await request(1, 'openSession', { kind: 'recording', params: PARAMS })
    tick()

    const [, sx, sy, sw, sh, dx, , dw, dh] = drawImages.at(-1) as number[]
    expect([sx, sy, sw, sh]).toEqual([960, 0, 960, 1080])
    expect([dw, dh]).toEqual([960, 1080]) // not stretched to fill the box
    expect(dx).toBe(-480)
  })

  it('draws an uncropped source with the plain form', async () => {
    pushState(snap())
    await request(1, 'openSession', { kind: 'recording', params: PARAMS })
    tick()
    expect(drawImages.at(-1)).toHaveLength(5)
  })

  it('draws an unfiltered source with none', async () => {
    pushState(snap())
    await request(1, 'openSession', { kind: 'recording', params: PARAMS })
    tick()
    expect(filtersSet.every((f) => f === 'none')).toBe(true)
  })

  it('puts SVG filters in the page before drawing with them', async () => {
    pushState(snap({ sources: [filtered('a', [key])] }))
    await request(1, 'openSession', { kind: 'recording', params: PARAMS })
    expect(filterDefs.at(-1)).toContain('id="cbf-k1"')
  })

  it('does not rewrite the page when the filters have not changed', async () => {
    pushState(snap({ sources: [filtered('a', [key])] }))
    await request(1, 'openSession', { kind: 'recording', params: PARAMS })
    const before = filterDefs.length
    pushState(snap({ sources: [filtered('a', [key])] }))
    pushState(snap({ sources: [filtered('a', [key])] }))
    expect(filterDefs.length).toBe(before)
  })

  it('updates the page when a filter changes', async () => {
    pushState(snap({ sources: [filtered('a', [key])] }))
    await request(1, 'openSession', { kind: 'recording', params: PARAMS })
    pushState(snap({ sources: [filtered('a', [{ ...key, similarity: 300 }])] }))
    expect(new Set(filterDefs).size).toBeGreaterThan(1)
  })

  it('clears the page of filters for a source that has gone', async () => {
    pushState(snap({ sources: [filtered('a', [key])] }))
    await request(1, 'openSession', { kind: 'recording', params: PARAMS })
    pushState(snap({ sources: [] }))
    expect(filterDefs.at(-1)).toBe('')
  })

  it('picks up a changed filter on the next frame', async () => {
    pushState(snap({ sources: [filtered('a', [blur])] }))
    await request(1, 'openSession', { kind: 'recording', params: PARAMS })
    tick()
    filtersSet.length = 0

    pushState(snap({ sources: [filtered('a', [{ ...blur, radius: 30 }])] }))
    clockMs = 100
    tick()
    expect(filtersSet).toContain('blur(20px)')
  })
})

describe('scene transitions', () => {
  const old = (id: string): SnapshotSource => ({ ...src(id), settings: {}, filters: [] })
  const moving = (type: 'fade' | 'slide' | 'wipe', startedAt = 0, durationMs = 1000) => ({
    type, durationMs, startedAt, from: [old('old')],
  })
  const names = () => ctxCalls.map((c) => c[0])
  const alphas = () => ctxCalls.filter((c) => c[0] === 'globalAlpha').map((c) => c[1])

  async function onAir(transition?: ReturnType<typeof moving>) {
    pushState({ ...snap({ sources: [src('new')] }), ...(transition ? { transition } : {}) })
    await request(1, 'openSession', { kind: 'recording', params: PARAMS })
    ctxCalls.length = 0
    drawImages.length = 0
  }

  it('draws one scene when no transition is under way', async () => {
    await onAir()
    tick()
    expect(drawImages).toHaveLength(1)
  })

  it('draws the outgoing scene, then the incoming one over it, while a transition runs', async () => {
    await onAir(moving('fade'))
    wallMs = 500
    clockMs = 100
    tick()
    expect(drawImages).toHaveLength(2)
    // Black is painted once, before the first; the second goes over without clearing.
    expect(names().filter((n) => n === 'fillRect')).toHaveLength(1)
  })

  it('brings a fade in by its eased amount', async () => {
    await onAir(moving('fade'))
    wallMs = 500 // half way: eased 0.5
    clockMs = 100
    tick()
    expect(alphas().some((a) => Math.abs((a as number) - 0.5) < 0.01)).toBe(true)
  })

  it('starts a fade from nothing and so shows only the old scene at first', async () => {
    await onAir(moving('fade'))
    wallMs = 0
    clockMs = 100
    tick()
    expect(alphas()).toContain(0)
  })

  it('moves both scenes for a slide', async () => {
    await onAir(moving('slide'))
    wallMs = 500
    clockMs = 100
    tick()
    const shifts = ctxCalls.filter((c) => c[0] === 'translate' && c[2] === 0 && Math.abs(c[1] as number) > 1).map((c) => Math.round(c[1] as number))
    expect(shifts.sort((a, b) => a - b)).toEqual([-960, 960])
  })

  it('clips the incoming scene to the part uncovered so far for a wipe', async () => {
    await onAir(moving('wipe'))
    wallMs = 500
    clockMs = 100
    tick()
    const rects = ctxCalls.filter((c) => c[0] === 'rect' && c[3] !== 1080).map((c) => c.slice(1))
    expect(rects.some((r) => Math.abs((r[2] as number) - 960) < 1)).toBe(true)
  })

  it('goes back to drawing one scene once the transition is over', async () => {
    await onAir(moving('fade'))
    wallMs = 5000
    clockMs = 100
    tick()
    expect(drawImages).toHaveLength(1)
  })

  it('opens captures for the outgoing scene while it is still showing', async () => {
    pushState({ ...snap({ sources: [src('new')] }), transition: moving('fade') })
    await request(1, 'openSession', { kind: 'recording', params: PARAMS })
    expect(opens).toBe(2)
  })

  it('lets go of the outgoing scene captures after the transition', async () => {
    pushState({ ...snap({ sources: [src('new')] }), transition: moving('fade') })
    await request(1, 'openSession', { kind: 'recording', params: PARAMS })
    pushState(snap({ sources: [src('new')] }))
    // The outgoing source is no longer wanted, so asking for it again opens it afresh.
    pushState({ ...snap({ sources: [src('new')] }), transition: moving('fade') })
    await settle()
    expect(opens).toBe(3)
  })
})

describe('media files', () => {
  const clip = (id: string, settings: SnapshotSource['settings'] = { filePath: 'a.mp4' }): SnapshotSource => ({
    ...src(id), type: 'media_source', target: null, settings,
  })

  it('draws a playing file like any other source, without a capture', async () => {
    pushState(snap({ sources: [clip('m')] }))
    await request(1, 'openSession', { kind: 'recording', params: PARAMS })
    await settle()
    drawImages.length = 0
    tick()

    expect(opens).toBe(0)
    expect(mediaVideos).toHaveLength(1)
    expect(drawImages).toHaveLength(1)
  })

  it('puts the sound of the file into the mix, at the level set', async () => {
    pushState(snap({ sources: [clip('m', { filePath: 'a.mp4', volume: 0.3 })] }))
    await request(1, 'openSession', { kind: 'recording', params: PARAMS })
    await settle()

    expect(streamsAttached).toEqual([{ id: 'm', gain: 0.3, detached: false }])
  })

  it('follows a change of volume while playing, without attaching it again', async () => {
    pushState(snap({ sources: [clip('m', { filePath: 'a.mp4', volume: 1 })] }))
    await request(1, 'openSession', { kind: 'recording', params: PARAMS })
    await settle()
    pushState(snap({ sources: [clip('m', { filePath: 'a.mp4', volume: 0.2 })] }))

    expect(streamsAttached).toHaveLength(1)
    expect(streamsAttached[0].gain).toBe(0.2)
  })

  it('takes the sound out when the source is removed', async () => {
    pushState(snap({ sources: [clip('m')] }))
    await request(1, 'openSession', { kind: 'recording', params: PARAMS })
    await settle()
    pushState(snap({ sources: [] }))
    expect(streamsAttached[0].detached).toBe(true)
  })

  it('takes the sound out when the output ends', async () => {
    pushState(snap({ sources: [clip('m')] }))
    await request(1, 'openSession', { kind: 'recording', params: PARAMS })
    await settle()
    await request(2, 'closeSession', { kind: 'recording' })
    expect(streamsAttached[0].detached).toBe(true)
  })

  it('has no sound for an output that carries none', async () => {
    pushState(snap({ sources: [clip('m')] }))
    await request(1, 'openSession', { kind: 'virtualCamera', params: { ...PARAMS, audio: false } })
    await settle()
    expect(streamsAttached).toEqual([])
    expect(mediaVideos).toHaveLength(1) // but the picture still plays
  })

  it('does not play anything while no output is running', async () => {
    pushState(snap({ sources: [clip('m')] }))
    await settle()
    expect(mediaVideos).toHaveLength(0)
  })
})

describe('web pages', () => {
  const web = (id: string, settings: SnapshotSource['settings'] = { url: 'https://example.com/overlay' }): SnapshotSource => ({
    ...src(id), type: 'browser_source', target: null, settings,
  })

  it('starts a page for the output and draws its picture over the scene', async () => {
    pushState(snap({ sources: [web('w')] }))
    await request(1, 'openSession', { kind: 'recording', params: PARAMS })
    pushPage('w', { width: 1280, height: 720, x: 0, y: 0, w: 1280, h: 720, bgra: new Uint8Array(4) })
    drawImages.length = 0
    tick()

    expect(browserAttached).toEqual(['w'])
    expect(opens).toBe(0)
    expect(drawImages).toHaveLength(1)
  })

  it('draws nothing for a page that has not painted yet', async () => {
    pushState(snap({ sources: [web('w')] }))
    await request(1, 'openSession', { kind: 'recording', params: PARAMS })
    drawImages.length = 0
    tick()
    expect(drawImages).toHaveLength(0)
  })

  it('lets go of the page when its source is removed', async () => {
    pushState(snap({ sources: [web('w')] }))
    await request(1, 'openSession', { kind: 'recording', params: PARAMS })
    pushState(snap({ sources: [] }))
    expect(browserDetached).toEqual(['w'])
  })

  it('lets go of every page when the output ends', async () => {
    pushState(snap({ sources: [web('w')] }))
    await request(1, 'openSession', { kind: 'recording', params: PARAMS })
    await request(2, 'closeSession', { kind: 'recording' })
    expect(browserDetached).toEqual(['w'])
  })

  it('does not start a page while no output is running', async () => {
    pushState(snap({ sources: [web('w')] }))
    await settle()
    expect(browserAttached).toEqual([])
  })

  it('does not start a page twice for the same scene', async () => {
    pushState(snap({ sources: [web('w')] }))
    await request(1, 'openSession', { kind: 'recording', params: PARAMS })
    pushState(snap({ sources: [web('w')] }))
    expect(browserAttached).toHaveLength(1)
  })
})

describe('recording with several audio tracks', () => {
  const block = (): AudioBlock => ({
    startSec: 0, frames: 1024, data: new Float32Array(2048), mic: new Float32Array(2048), other: new Float32Array(2048),
  })
  const channels = () => sent.filter((s) => s.channel === HOST_CHANNELS.ingest).map((s) => s.args[0])

  it('encodes each block once for every track', async () => {
    pushState(snap())
    await request(1, 'openSession', { kind: 'recording', params: { ...PARAMS, tracks: 3 } })
    onBlock(block())

    expect(encoded.audio).toBe(3)
  })

  it('encodes one track when only one is asked for', async () => {
    pushState(snap())
    await request(1, 'openSession', { kind: 'recording', params: { ...PARAMS, tracks: 1 } })
    onBlock(block())

    expect(encoded.audio).toBe(1)
  })

  it('sends each track on a channel of its own, the first as the recording itself', async () => {
    pushState(snap())
    await request(1, 'openSession', { kind: 'recording', params: { ...PARAMS, tracks: 3 } })
    await request(2, 'closeSession', { kind: 'recording' })

    expect([...new Set(channels())].sort()).toEqual(['recording', 'recording#2', 'recording#3'])
  })

  it('sends only the recording itself when there is one track', async () => {
    pushState(snap())
    await request(1, 'openSession', { kind: 'recording', params: { ...PARAMS, tracks: 1 } })
    await request(2, 'closeSession', { kind: 'recording' })

    expect([...new Set(channels())]).toEqual(['recording'])
  })

  it('keeps a stream to one track however many the recording has', async () => {
    pushState(snap())
    await request(1, 'openSession', { kind: 'streaming', params: { ...PARAMS, tracks: 1 } })
    await request(2, 'openSession', { kind: 'recording', params: { ...PARAMS, tracks: 3 } })
    onBlock(block())

    expect(encoded.audio).toBe(4)
  })
})
