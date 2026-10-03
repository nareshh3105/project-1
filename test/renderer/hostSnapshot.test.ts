import { describe, it, expect } from 'vitest'
import { buildSnapshot, outputParams, suggestedVideoBitrate } from '../../src/lib/hostSnapshot'
import { DEFAULT_RECORDING, DEFAULT_VIDEO } from '../../src/stores/settingsStore'
import type { SourceItem } from '../../src/stores/sourceStore'
import type { AudioChannel } from '../../src/stores/audioStore'

/**
 * The host only knows what the interface tells it. The order of layers, which
 * sources are hidden and what the output is asked to produce all cross here,
 * and a mistake shows up as a recording that differs from the preview.
 */

const T = { x: 10, y: 20, width: 640, height: 360, rotation: 0, scaleX: 1, scaleY: 1 }
const source = (id: string, over: Partial<SourceItem> = {}): SourceItem => ({
  id, sceneId: 's', name: id, sourceType: 'display_capture',
  settings: { capture: { kind: 'screen', id: 'screen:0:0', name: 'Entire screen' } },
  orderIndex: 0, visible: true, locked: false, muted: false, volume: 1,
  transform: { ...T }, createdAt: 0, updatedAt: 0, ...over,
})
const channel = (id: string, over: Partial<AudioChannel> = {}): AudioChannel => ({
  id, name: id, volume: 1, muted: false, noiseSuppression: false,
  levels: { peakL: -100, peakR: -100, rmsL: -100, rmsR: -100 }, ...over,
})
const BASE = { width: 1920, height: 1080 }

describe('buildSnapshot', () => {
  // The preview paints by orderIndex, lowest at the bottom; so must the recording.
  it('stacks layers by orderIndex, lowest at the bottom, whatever the list order', () => {
    const snap = buildSnapshot({
      sources: [source('top', { orderIndex: 2 }), source('bottom', { orderIndex: 0 }), source('mid', { orderIndex: 1 })],
      base: BASE, channels: [], connected: [],
    })
    const drawOrder = [...snap.sources].sort((a, b) => a.order - b.order).map((s) => s.id)
    expect(drawOrder).toEqual(['bottom', 'mid', 'top'])
  })

  it('does not reorder the list it was given', () => {
    const list = [source('b', { orderIndex: 1 }), source('a', { orderIndex: 0 })]
    buildSnapshot({ sources: list, base: BASE, channels: [], connected: [] })
    expect(list.map((s) => s.id)).toEqual(['b', 'a'])
  })

  it('leaves out hidden sources, and ranks the rest without gaps', () => {
    const snap = buildSnapshot({
      sources: [source('a', { orderIndex: 0 }), source('hidden', { visible: false, orderIndex: 1 }), source('b', { orderIndex: 2 })],
      base: BASE, channels: [], connected: [],
    })
    expect(snap.sources.map((s) => s.id)).toEqual(['a', 'b'])
    expect(snap.sources.map((s) => s.order).sort()).toEqual([0, 1])
  })

  it('carries position, size and the capture target', () => {
    const [s] = buildSnapshot({ sources: [source('a')], base: BASE, channels: [], connected: [] }).sources
    expect(s.transform).toEqual(T)
    expect(s.target).toEqual({ kind: 'screen', id: 'screen:0:0', name: 'Entire screen' })
    expect(s.type).toBe('display_capture')
  })

  it('copies the transform, so later drags do not rewrite a snapshot already sent', () => {
    const item = source('a')
    const [s] = buildSnapshot({ sources: [item], base: BASE, channels: [], connected: [] }).sources
    item.transform.x = 999
    expect(s.transform.x).toBe(10)
  })

  it('has no target for a source that was never set up', () => {
    const [s] = buildSnapshot({ sources: [source('a', { settings: {} })], base: BASE, channels: [], connected: [] }).sources
    expect(s.target).toBeNull()
  })

  it('says which channels have a real input', () => {
    const snap = buildSnapshot({
      sources: [], base: BASE, connected: ['mic'],
      channels: [channel('mic', { volume: 0.5, muted: true }), channel('desktop')],
    })
    expect(snap.audio).toEqual([
      { id: 'mic', volume: 0.5, muted: true, noiseSuppression: false, connected: true },
      { id: 'desktop', volume: 1, muted: false, noiseSuppression: false, connected: false },
    ])
  })

  it('does not send meter levels, which change constantly and mean nothing to the host', () => {
    const snap = buildSnapshot({ sources: [], base: BASE, channels: [channel('mic')], connected: ['mic'] })
    expect(JSON.stringify(snap)).not.toContain('peak')
  })

  it('is identical for identical state, so repeats can be skipped', () => {
    const a = buildSnapshot({ sources: [source('a')], base: BASE, channels: [channel('mic')], connected: [] })
    const b = buildSnapshot({ sources: [source('a')], base: BASE, channels: [channel('mic')], connected: [] })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})

describe('outputParams', () => {
  const settings = { video: DEFAULT_VIDEO, recording: DEFAULT_RECORDING }

  it('uses the output resolution and frame rate from Video settings', () => {
    const p = outputParams({ ...settings, video: { ...DEFAULT_VIDEO, outputResolution: { width: 1920, height: 1080 } as never, fps: 60 } }, 'recording')
    expect([p.width, p.height, p.fps]).toEqual([1920, 1080, 60])
  })

  it('picks a bitrate to suit the size when left on automatic', () => {
    const p = outputParams(settings, 'recording')
    expect(p.videoBitrate).toBe(suggestedVideoBitrate(1280, 720, 30))
  })

  it('uses the bitrate the user chose, converting kbit/s', () => {
    const p = outputParams({ ...settings, recording: { ...DEFAULT_RECORDING, videoBitrateKbps: 8000, audioBitrateKbps: 192 } }, 'streaming')
    expect(p.videoBitrate).toBe(8_000_000)
    expect(p.audioBitrate).toBe(192_000)
  })

  it('passes the encoder preference', () => {
    expect(outputParams({ ...settings, recording: { ...DEFAULT_RECORDING, encoder: 'software' } }, 'recording').encoder).toBe('software')
  })

  it('asks for sound everywhere but the virtual camera', () => {
    expect(outputParams(settings, 'recording').audio).toBe(true)
    expect(outputParams(settings, 'streaming').audio).toBe(true)
    expect(outputParams(settings, 'replay').audio).toBe(true)
    expect(outputParams(settings, 'virtualCamera').audio).toBe(false)
  })
})

describe('suggestedVideoBitrate', () => {
  it.each([
    [1280, 720, 30, 2_700_000],
    [1920, 1080, 30, 6_000_000],
    [1920, 1080, 60, 12_100_000],
  ])('%sx%s at %s fps', (w, h, fps, expected) => {
    expect(suggestedVideoBitrate(w, h, fps)).toBe(expected)
  })

  it('never goes below a usable floor or above the limit', () => {
    expect(suggestedVideoBitrate(64, 64, 1)).toBe(1_000_000)
    expect(suggestedVideoBitrate(7680, 4320, 120)).toBe(100_000_000)
  })
})
