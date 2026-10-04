import { describe, it, expect, beforeEach } from 'vitest'
import { StaticLayers, type StaticDeps, type LoadedImage } from '../../src/host/staticLayers'
import type { SnapshotSource } from '../../shared/host'
import type { PaintContext } from '../../src/lib/sources/static'

/**
 * Colors, text and images are drawn from settings alone. They must repaint when
 * their look changes and not otherwise (a frame is drawn 30 times a second),
 * and must cope with an image that is slow, missing, or replaced while loading.
 */

const T = { x: 0, y: 0, width: 400, height: 200, rotation: 0, scaleX: 1, scaleY: 1 }
const src = (id: string, type: string, settings: SnapshotSource['settings'] = {}, over: Partial<SnapshotSource['transform']> = {}): SnapshotSource => ({
  id, type, order: 0, transform: { ...T, ...over }, target: null, settings,
})

let canvases: Array<{ w: number; h: number; painted: string[] }>
let loads: Array<{ path: string; resolve: (i: LoadedImage) => void; reject: (e: Error) => void }>
let changes: number
let layers: StaticLayers

const settle = () => new Promise((r) => setTimeout(r, 0))
const picture = (w = 640, h = 360): LoadedImage => ({ image: { tag: 'bitmap' } as unknown as CanvasImageSource, width: w, height: h })

beforeEach(() => {
  canvases = []; loads = []; changes = 0
  const deps: StaticDeps = {
    createCanvas: (w, h) => {
      const rec = { w, h, painted: [] as string[] }
      canvases.push(rec)
      const context: PaintContext = {
        fillStyle: '', font: '', textBaseline: 'alphabetic', textAlign: 'start',
        clearRect: () => {},
        fillRect: function () { rec.painted.push(`fill:${String((this as PaintContext).fillStyle)}`) },
        fillText: (t) => { rec.painted.push(`text:${t}`) },
        measureText: (t) => ({ width: t.length * 10 }),
      }
      return { canvas: { tag: `canvas${canvases.length}` } as unknown as CanvasImageSource, context }
    },
    loadImage: (path) => new Promise<LoadedImage>((resolve, reject) => { loads.push({ path, resolve, reject }) }),
  }
  layers = new StaticLayers(deps, () => { changes++ })
})

describe('colors', () => {
  it('are painted at the size of their box', () => {
    const f = layers.frameFor(src('a', 'color_source', { color: '#ff0000' }, { width: 300, height: 100 }))!
    expect([f.width, f.height]).toEqual([300, 100])
    expect(canvases[0].painted).toContain('fill:#ff0000')
  })

  it('are not repainted while nothing changes', () => {
    const s = src('a', 'color_source', { color: '#ff0000' })
    layers.frameFor(s); layers.frameFor(s); layers.frameFor({ ...s })
    expect(canvases).toHaveLength(1)
  })

  it('are repainted when the color changes', () => {
    layers.frameFor(src('a', 'color_source', { color: '#ff0000' }))
    layers.frameFor(src('a', 'color_source', { color: '#00ff00' }))
    expect(canvases).toHaveLength(2)
  })

  it('are repainted when the box is resized, but not when it only moves', () => {
    layers.frameFor(src('a', 'color_source', {}, { x: 0 }))
    layers.frameFor(src('a', 'color_source', {}, { x: 500 }))
    expect(canvases).toHaveLength(1)
    layers.frameFor(src('a', 'color_source', {}, { width: 800 }))
    expect(canvases).toHaveLength(2)
  })

  it('keep a box inside sane limits', () => {
    const f = layers.frameFor(src('a', 'color_source', {}, { width: 90_000, height: 0.2 }))!
    expect([f.width, f.height]).toEqual([4096, 1])
  })
})

describe('text', () => {
  it('is painted with its words', () => {
    layers.frameFor(src('a', 'text_gdi_plus', { text: 'Hello' }))
    expect(canvases[0].painted).toContain('text:Hello')
  })

  it('is repainted when the words change, and only then', () => {
    const base = src('a', 'text_gdi_plus', { text: 'one' })
    layers.frameFor(base); layers.frameFor(base)
    expect(canvases).toHaveLength(1)
    layers.frameFor(src('a', 'text_gdi_plus', { text: 'two' }))
    expect(canvases).toHaveLength(2)
    expect(canvases[1].painted).toContain('text:two')
  })

  it('uses a default for settings that make no sense', () => {
    layers.frameFor(src('a', 'text_gdi_plus', { text: 5 as never, fontSize: 'big' as never }))
    expect(canvases[0].painted).toContain('text:Text')
  })

  it('gives each source its own canvas', () => {
    const a = layers.frameFor(src('a', 'text_gdi_plus', { text: 'x' }))!
    const b = layers.frameFor(src('b', 'text_gdi_plus', { text: 'x' }))!
    expect(a.image).not.toBe(b.image)
  })
})

describe('images', () => {
  it('have nothing to draw until loaded', () => {
    expect(layers.frameFor(src('a', 'image', { filePath: 'C:\\p\\a.png' }))).toBeNull()
    expect(loads.map((l) => l.path)).toEqual(['C:\\p\\a.png'])
  })

  it('appear once loaded, at their own size', async () => {
    const s = src('a', 'image', { filePath: 'a.png' })
    layers.frameFor(s)
    loads[0].resolve(picture(1000, 500))
    await settle()

    expect(layers.frameFor(s)).toMatchObject({ width: 1000, height: 500 })
    expect(changes).toBe(1)
  })

  it('are loaded once, however often they are asked for', () => {
    const s = src('a', 'image', { filePath: 'a.png' })
    for (let i = 0; i < 50; i++) layers.frameFor(s)
    expect(loads).toHaveLength(1)
  })

  it('are loaded again when pointed at another file', async () => {
    layers.frameFor(src('a', 'image', { filePath: 'a.png' }))
    loads[0].resolve(picture())
    await settle()
    expect(layers.frameFor(src('a', 'image', { filePath: 'b.png' }))).toBeNull()
    expect(loads.map((l) => l.path)).toEqual(['a.png', 'b.png'])
  })

  it('ignore a picture that arrives after the source moved to another file', async () => {
    layers.frameFor(src('a', 'image', { filePath: 'a.png' }))
    layers.frameFor(src('a', 'image', { filePath: 'b.png' }))
    loads[0].resolve(picture(111, 111)) // the stale one
    await settle()
    expect(changes).toBe(0)

    loads[1].resolve(picture(222, 222))
    await settle()
    expect(layers.frameFor(src('a', 'image', { filePath: 'b.png' }))).toMatchObject({ width: 222 })
  })

  it('ignore a picture that arrives after the source was removed', async () => {
    layers.frameFor(src('a', 'image', { filePath: 'a.png' }))
    layers.prune([])
    loads[0].resolve(picture())
    await settle()
    expect(changes).toBe(0)
  })

  it('say why a picture could not be loaded, and do not retry on their own', async () => {
    const s = src('a', 'image', { filePath: 'a.png' })
    layers.frameFor(s)
    loads[0].reject(new Error('The picture could not be found.'))
    await settle()

    expect(layers.errors()).toEqual({ a: 'The picture could not be found.' })
    expect(layers.frameFor(s)).toBeNull()
    expect(loads).toHaveLength(1)
    expect(changes).toBe(1)
  })

  it('use a plain message when the failure has none', async () => {
    layers.frameFor(src('a', 'image', { filePath: 'a.png' }))
    loads[0].reject(new Error(''))
    await settle()
    expect(layers.errors().a).toBe('The picture could not be loaded.')
  })

  it('have nothing to draw, and no error, before a file is chosen', () => {
    expect(layers.frameFor(src('a', 'image', {}))).toBeNull()
    expect(loads).toHaveLength(0)
    expect(layers.errors()).toEqual({})
  })

  it('refuse a file that is not a picture without trying to load it', () => {
    layers.frameFor(src('a', 'image', { filePath: 'C:\\x\\run.exe' }))
    expect(loads).toHaveLength(0)
    expect(layers.errors().a).toMatch(/not a picture/)
  })
})

describe('other sources and housekeeping', () => {
  it('have nothing for capture sources', () => {
    expect(layers.frameFor(src('a', 'display_capture'))).toBeNull()
  })

  it('forget sources that left the scene', () => {
    layers.frameFor(src('a', 'color_source', {}))
    layers.prune([])
    layers.frameFor(src('a', 'color_source', {}))
    expect(canvases).toHaveLength(2)
  })

  it('keep the sources that stay', () => {
    const s = src('a', 'color_source', {})
    layers.frameFor(s)
    layers.prune([s])
    layers.frameFor(s)
    expect(canvases).toHaveLength(1)
  })

  it('clear everything', () => {
    layers.frameFor(src('a', 'color_source', {}))
    layers.clear()
    layers.frameFor(src('a', 'color_source', {}))
    expect(canvases).toHaveLength(2)
  })
})
