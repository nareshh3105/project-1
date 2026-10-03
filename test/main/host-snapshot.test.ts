import { describe, it, expect } from 'vitest'
import { sanitizeSnapshot } from '../../electron/main/host/snapshot'
import { EMPTY_SNAPSHOT } from '../../shared/host'

/**
 * What the interface sends the host drives a canvas and an audio mixer, so
 * malformed entries are repaired or dropped before they get there.
 */

const goodSource = {
  id: 's1', type: 'display_capture', order: 0,
  transform: { x: 10, y: 20, width: 800, height: 600, rotation: 15, scaleX: 1.5, scaleY: 2 },
  target: { kind: 'screen', id: 'screen:0:0', name: 'Entire screen' },
}

const goodChannel = { id: 'mic', volume: 0.5, muted: true, noiseSuppression: true, connected: true }

describe('the whole snapshot', () => {
  it.each([null, undefined, 42, 'x', [], true])('falls back to empty for %s', (bad) => {
    expect(sanitizeSnapshot(bad)).toEqual(EMPTY_SNAPSHOT)
  })

  it('gives empty lists when they are missing or the wrong type', () => {
    expect(sanitizeSnapshot({})).toEqual(EMPTY_SNAPSHOT)
    expect(sanitizeSnapshot({ sources: 'no', audio: 7 })).toEqual(EMPTY_SNAPSHOT)
  })

  it('passes a good snapshot through unchanged', () => {
    const given = { base: { width: 1280, height: 720 }, sources: [goodSource], audio: [goodChannel] }
    expect(sanitizeSnapshot(given)).toEqual(given)
  })
})

describe('the base canvas', () => {
  it('keeps a valid size', () => {
    expect(sanitizeSnapshot({ base: { width: 2560, height: 1440 } }).base).toEqual({ width: 2560, height: 1440 })
  })

  it.each([0, -1, NaN, Infinity, 'big', null])('replaces a width of %s', (bad) => {
    expect(sanitizeSnapshot({ base: { width: bad, height: 720 } }).base.width).toBe(1920)
  })
})

describe('sources', () => {
  const sourcesOf = (s: unknown[]) => sanitizeSnapshot({ sources: s }).sources

  it('drops an entry with no id', () => {
    expect(sourcesOf([{ ...goodSource, id: undefined }, { ...goodSource, id: '' }, goodSource])).toHaveLength(1)
  })

  it('drops an entry that is not an object', () => {
    expect(sourcesOf([null, 7, 'x', [], goodSource])).toHaveLength(1)
  })

  it('drops an entry with no type', () => {
    expect(sourcesOf([{ ...goodSource, type: 5 }])).toEqual([])
  })

  it('numbers a source by its position when it has no order', () => {
    const list = sourcesOf([{ ...goodSource, id: 'a', order: undefined }, { ...goodSource, id: 'b', order: undefined }])
    expect(list.map((s) => s.order)).toEqual([0, 1])
  })

  it('fills a missing transform from the canvas', () => {
    const [s] = sanitizeSnapshot({ base: { width: 1280, height: 720 }, sources: [{ id: 'a', type: 'display_capture' }] }).sources
    expect(s.transform).toEqual({ x: 0, y: 0, width: 1280, height: 720, rotation: 0, scaleX: 1, scaleY: 1 })
  })

  it.each([NaN, Infinity, 'left', null])('replaces a position of %s', (bad) => {
    const [s] = sourcesOf([{ ...goodSource, transform: { ...goodSource.transform, x: bad } }])
    expect(s.transform.x).toBe(0)
  })

  it.each([0, -50, NaN])('replaces a size of %s', (bad) => {
    const [s] = sourcesOf([{ ...goodSource, transform: { ...goodSource.transform, width: bad } }])
    expect(s.transform.width).toBe(1920)
  })

  // A zero scale would make a source vanish with no explanation.
  it('treats a scale of zero as missing', () => {
    const [s] = sourcesOf([{ ...goodSource, transform: { ...goodSource.transform, scaleX: 0, scaleY: 0 } }])
    expect(s.transform.scaleX).toBe(1)
    expect(s.transform.scaleY).toBe(1)
  })

  it('keeps a negative scale, which flips a source', () => {
    const [s] = sourcesOf([{ ...goodSource, transform: { ...goodSource.transform, scaleX: -1 } }])
    expect(s.transform.scaleX).toBe(-1)
  })

  it('caps how many sources it accepts', () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ ...goodSource, id: `s${i}` }))
    expect(sourcesOf(many)).toHaveLength(200)
  })
})

describe('capture targets', () => {
  const targetOf = (t: unknown) => sanitizeSnapshot({ sources: [{ ...goodSource, target: t }] }).sources[0].target

  it('keeps a valid one', () => {
    expect(targetOf(goodSource.target)).toEqual(goodSource.target)
  })

  it.each([
    ['null', null], ['a string', 'screen'], ['an unknown kind', { kind: 'printer', id: 'x', name: '' }],
    ['no id', { kind: 'screen', name: 'x' }], ['an empty id', { kind: 'screen', id: '', name: 'x' }],
  ])('becomes null for %s', (_label, bad) => {
    expect(targetOf(bad)).toBeNull()
  })

  it('tolerates a missing name', () => {
    expect(targetOf({ kind: 'screen', id: 'screen:0:0' })?.name).toBe('')
  })
})

describe('audio channels', () => {
  const audioOf = (c: unknown[]) => sanitizeSnapshot({ audio: c }).audio

  it('drops an entry with no id', () => {
    expect(audioOf([{ ...goodChannel, id: '' }, null, goodChannel])).toHaveLength(1)
  })

  it('keeps a level between zero and one', () => {
    expect(audioOf([{ ...goodChannel, volume: 0.25 }])[0].volume).toBe(0.25)
  })

  // A level above one would amplify; below zero would invert the signal.
  it('clamps a level into range', () => {
    expect(audioOf([{ ...goodChannel, volume: 5 }])[0].volume).toBe(1)
    expect(audioOf([{ ...goodChannel, volume: -2 }])[0].volume).toBe(0)
  })

  it('treats a missing or broken level as full', () => {
    expect(audioOf([{ ...goodChannel, volume: undefined }])[0].volume).toBe(1)
    expect(audioOf([{ ...goodChannel, volume: NaN }])[0].volume).toBe(1)
  })

  it('treats a flag as set only when it is exactly true', () => {
    const [c] = audioOf([{ id: 'mic', muted: 'yes', noiseSuppression: 1, connected: 'true' }])
    expect(c).toMatchObject({ muted: false, noiseSuppression: false, connected: false })
  })

  it('caps how many channels it accepts', () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ ...goodChannel, id: `c${i}` }))
    expect(audioOf(many)).toHaveLength(16)
  })
})
