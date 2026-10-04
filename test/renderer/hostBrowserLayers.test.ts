import { describe, it, expect, beforeEach } from 'vitest'
import { BrowserLayers, type BrowserDeps, type PageSurface } from '../../src/host/browserLayers'
import type { PageUpdate, SnapshotSource } from '../../shared/host'

/**
 * Web pages in the scene: started when wanted, restarted only when they have to
 * be, drawn from the latest picture, and let go of cleanly.
 */

const T = { x: 0, y: 0, width: 640, height: 360, rotation: 0, scaleX: 1, scaleY: 1 }
const page = (id: string, settings: SnapshotSource['settings'] = { url: 'https://example.com' }): SnapshotSource => ({
  id, type: 'browser_source', order: 0, transform: T, target: null, settings, filters: [],
})

class FakeSurface implements PageSurface {
  drawn: PageUpdate[] = []
  readonly canvas = { tag: 'canvas' } as unknown as CanvasImageSource
  constructor(readonly width: number, readonly height: number) {}
  draw(update: PageUpdate) { this.drawn.push(update) }
}

let attached: Array<{ id: string; spec: { url: string; width: number; height: number; fps: number } }>
let detached: string[]
let surfaces: FakeSurface[]
let emitFrame: (id: string, update: PageUpdate) => void
let emitFailure: (id: string, message: string) => void
let attachResult: () => Promise<unknown>
let changes: number
let unsubscribed: number
let layers: BrowserLayers

const settle = () => new Promise((r) => setTimeout(r, 0))
/** A region of a page that is `width` by `height`. */
const update = (width: number, height: number, x = 0, y = 0, w = width, h = height): PageUpdate =>
  ({ width, height, x, y, w, h, bgra: new Uint8Array(w * h * 4) })

beforeEach(() => {
  attached = []; detached = []; surfaces = []; changes = 0; unsubscribed = 0
  attachResult = async () => undefined
  const deps: BrowserDeps = {
    attach: (id, spec) => { attached.push({ id, spec }); return attachResult() },
    detach: (id) => { detached.push(id) },
    onFrame: (cb) => { emitFrame = cb; return () => { unsubscribed++ } },
    onFailure: (cb) => { emitFailure = cb; return () => { unsubscribed++ } },
    createSurface: (w, h) => { const s = new FakeSurface(w, h); surfaces.push(s); return s },
  }
  layers = new BrowserLayers(deps, () => { changes++ })
})

describe('starting a page', () => {
  it('asks for the page at the size and speed set', () => {
    layers.sync([page('a', { url: 'https://example.com', width: 800, height: 600, fps: 15 })])
    expect(attached).toEqual([{ id: 'a', spec: { url: 'https://example.com', width: 800, height: 600, fps: 15 } }])
  })

  it('uses the defaults for what is not set', () => {
    layers.sync([page('a')])
    expect(attached[0].spec).toMatchObject({ width: 1280, height: 720, fps: 30 })
  })

  it('does nothing until an address is given', () => {
    layers.sync([page('a', {})])
    layers.sync([page('b', { url: '   ' })])
    expect(attached).toEqual([])
    expect(layers.size).toBe(0)
  })

  it('leaves out sources that are not pages', () => {
    layers.sync([{ ...page('a'), type: 'image' }, { ...page('b'), type: 'media_source' }])
    expect(attached).toEqual([])
  })

  it('runs several at once', () => {
    layers.sync([page('a'), page('b', { url: 'https://example.org' })])
    expect(attached.map((a) => a.id)).toEqual(['a', 'b'])
  })
})

describe('keeping up with changes', () => {
  it('does not restart a page that has not changed', () => {
    layers.sync([page('a')]); layers.sync([page('a')]); layers.sync([page('a')])
    expect(attached).toHaveLength(1)
  })

  it('does not restart a page whose position in the scene changed', () => {
    layers.sync([page('a')])
    layers.sync([{ ...page('a'), transform: { ...T, x: 500 } }])
    expect(attached).toHaveLength(1)
  })

  it.each([
    ['address', { url: 'https://example.org' }],
    ['width', { url: 'https://example.com', width: 900 }],
    ['height', { url: 'https://example.com', height: 900 }],
    ['speed', { url: 'https://example.com', fps: 10 }],
  ])('starts afresh when the %s changes, letting the old page go', (_what, settings) => {
    layers.sync([page('a')])
    layers.sync([page('a', settings)])
    expect(attached).toHaveLength(2)
    expect(detached).toEqual(['a'])
  })

  it('stops a page whose source was removed', () => {
    layers.sync([page('a')])
    layers.sync([])
    expect(detached).toEqual(['a'])
    expect(layers.size).toBe(0)
  })

  it('stops a page whose address was cleared', () => {
    layers.sync([page('a')])
    layers.sync([page('a', { url: '' })])
    expect(detached).toEqual(['a'])
  })

  it('stops everything', () => {
    layers.sync([page('a'), page('b', { url: 'https://example.org' })])
    layers.stopAll()
    expect(detached.sort()).toEqual(['a', 'b'])
  })

  it('stops listening when disposed', () => {
    layers.dispose()
    expect(unsubscribed).toBe(2)
  })
})

describe('the picture', () => {
  it('has none until the page has painted', () => {
    layers.sync([page('a')])
    expect(layers.frameFor('a')).toBeNull()
  })

  it('has none for a page it does not know', () => {
    expect(layers.frameFor('missing')).toBeNull()
  })

  it('is a canvas of the size of the page', () => {
    layers.sync([page('a')])
    emitFrame('a', update(1280, 720))
    expect(layers.frameFor('a')).toMatchObject({ width: 1280, height: 720 })
  })

  it('is drawn on with each region that changes', () => {
    layers.sync([page('a')])
    emitFrame('a', update(100, 80))
    emitFrame('a', update(100, 80, 10, 20, 30, 40))
    expect(surfaces).toHaveLength(1)
    expect(surfaces[0].drawn.map((u) => [u.x, u.y, u.w, u.h])).toEqual([[0, 0, 100, 80], [10, 20, 30, 40]])
  })

  // A static overlay paints once; the scene is drawn thirty times a second.
  it('is the same canvas however often it is drawn', () => {
    layers.sync([page('a')])
    emitFrame('a', update(4, 4))
    const first = layers.frameFor('a')!.image
    for (let i = 0; i < 100; i++) expect(layers.frameFor('a')!.image).toBe(first)
    expect(surfaces).toHaveLength(1)
  })

  it('starts a new canvas when the page changes size', () => {
    layers.sync([page('a')])
    emitFrame('a', update(100, 80))
    emitFrame('a', update(200, 160))
    expect(surfaces).toHaveLength(2)
    expect(layers.frameFor('a')).toMatchObject({ width: 200, height: 160 })
  })

  it('starts a new canvas when only the width changes, or only the height', () => {
    layers.sync([page('a')])
    emitFrame('a', update(100, 80))
    emitFrame('a', update(200, 80))
    emitFrame('a', update(200, 160))
    expect(surfaces).toHaveLength(3)
  })

  it('keeps the pictures of pages apart', () => {
    layers.sync([page('a'), page('b', { url: 'https://example.org' })])
    emitFrame('a', update(2, 2)); emitFrame('b', update(6, 6))
    expect(layers.frameFor('a')).toMatchObject({ width: 2 })
    expect(layers.frameFor('b')).toMatchObject({ width: 6 })
    expect(surfaces[0]).not.toBe(surfaces[1])
  })

  it('ignores a region for a page that has gone', () => {
    layers.sync([page('a')])
    layers.sync([])
    emitFrame('a', update(4, 4))
    expect(layers.frameFor('a')).toBeNull()
    expect(surfaces).toHaveLength(0)
  })

  it('does not show the picture of the previous address once restarted', () => {
    layers.sync([page('a')])
    emitFrame('a', update(4, 4))
    layers.sync([page('a', { url: 'https://example.org' })])
    expect(layers.frameFor('a')).toBeNull()
  })
})

describe('trouble', () => {
  it('records why a page could not be started', async () => {
    attachResult = async () => { throw new Error('Only web addresses starting with http:// or https:// can be used.') }
    layers.sync([page('a', { url: 'file:///C:/x' })])
    await settle()
    expect(layers.errors().a).toMatch(/Only web addresses/)
    expect(changes).toBe(1)
  })

  it('records why a page could not be loaded', () => {
    layers.sync([page('a')])
    emitFailure('a', 'The site refused the connection.')
    expect(layers.errors()).toEqual({ a: 'The site refused the connection.' })
  })

  it('forgets the trouble when the page paints', () => {
    layers.sync([page('a')])
    emitFailure('a', 'Blocked.')
    emitFrame('a', update(4, 4))
    expect(layers.errors()).toEqual({})
    expect(changes).toBe(2)
  })

  it('ignores a failure of a page it does not have', () => {
    emitFailure('ghost', 'x')
    expect(layers.errors()).toEqual({})
  })

  it('does not blame a page that has since been replaced', async () => {
    attachResult = () => new Promise((_r, reject) => setTimeout(() => reject(new Error('late')), 5))
    layers.sync([page('a')])
    layers.sync([])
    await new Promise((r) => setTimeout(r, 15))
    expect(layers.errors()).toEqual({})
    expect(changes).toBe(0)
  })

  it('still draws the last good picture of a page that then fails', () => {
    layers.sync([page('a')])
    emitFrame('a', update(4, 4))
    emitFailure('a', 'The site closed the connection without answering.')
    expect(layers.frameFor('a')).not.toBeNull()
  })

  it('does not disturb a page that works when another fails', () => {
    layers.sync([page('a'), page('b', { url: 'https://example.org' })])
    emitFrame('a', update(4, 4))
    emitFailure('b', 'nope')
    expect(layers.frameFor('a')).not.toBeNull()
    expect(layers.errors()).toEqual({ b: 'nope' })
  })
})
