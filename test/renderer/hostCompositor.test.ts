import { describe, it, expect } from 'vitest'
import { fitContain, outputMapping, layerPlan } from '../../src/host/geometry'
import { drawFrame, type DrawContext, type ReadyLayer } from '../../src/host/compositor'
import type { SnapshotTransform } from '../../shared/host'

/**
 * What the user arranges in the preview is what must be recorded. The preview
 * puts a box at the source's position and size, turned and scaled about its
 * centre, with the picture fitted inside by object-fit: contain. These pin
 * that rule for the canvas.
 */

const T = (over: Partial<SnapshotTransform> = {}): SnapshotTransform => ({
  x: 0, y: 0, width: 1920, height: 1080, rotation: 0, scaleX: 1, scaleY: 1, ...over,
})

describe('fitContain', () => {
  it('fills the box when the shapes match', () => {
    expect(fitContain(1920, 1080, 960, 540)).toEqual({ x: 0, y: 0, w: 960, h: 540 })
  })

  it('leaves bars above and below a picture that is too wide', () => {
    const r = fitContain(1920, 1080, 1000, 1000)
    expect(r.w).toBeCloseTo(1000)
    expect(r.h).toBeCloseTo(562.5)
    expect(r.x).toBeCloseTo(0)
    expect(r.y).toBeCloseTo(218.75)
  })

  it('leaves bars at the sides of a picture that is too tall', () => {
    const r = fitContain(1000, 2000, 1000, 1000)
    expect(r.h).toBe(1000)
    expect(r.w).toBe(500)
    expect(r.x).toBe(250)
    expect(r.y).toBe(0)
  })

  it('scales a small picture up to the box', () => {
    expect(fitContain(100, 100, 400, 400)).toEqual({ x: 0, y: 0, w: 400, h: 400 })
  })

  it('keeps the proportions', () => {
    const r = fitContain(1234, 567, 800, 600)
    expect(r.w / r.h).toBeCloseTo(1234 / 567)
  })

  it.each([[0, 100], [100, 0], [-5, 100], [NaN, 100]])('fills the box for a picture of %s x %s', (w, h) => {
    expect(fitContain(w, h, 640, 360)).toEqual({ x: 0, y: 0, w: 640, h: 360 })
  })

  it('never returns a negative size', () => {
    const r = fitContain(100, 100, -10, -10)
    expect(r.w).toBe(0)
    expect(r.h).toBe(0)
  })
})

describe('outputMapping', () => {
  it('is the identity when the output matches the canvas', () => {
    expect(outputMapping({ width: 1920, height: 1080 }, { width: 1920, height: 1080 })).toEqual({ scale: 1, offsetX: 0, offsetY: 0 })
  })

  it('scales down for a smaller output of the same shape', () => {
    expect(outputMapping({ width: 1920, height: 1080 }, { width: 1280, height: 720 })).toEqual({ scale: 2 / 3, offsetX: 0, offsetY: 0 })
  })

  it('centres the canvas with bars when the shapes differ, rather than stretching', () => {
    const m = outputMapping({ width: 1920, height: 1080 }, { width: 1000, height: 1000 })
    expect(m.scale).toBeCloseTo(1000 / 1920)
    expect(m.offsetX).toBeCloseTo(0)
    expect(m.offsetY).toBeCloseTo((1000 - 1080 * (1000 / 1920)) / 2)
  })
})

describe('layerPlan', () => {
  it('centres on the middle of the source\'s box', () => {
    const p = layerPlan(T({ x: 100, y: 200, width: 400, height: 300 }), { width: 400, height: 300 })
    expect(p.cx).toBe(300)
    expect(p.cy).toBe(350)
  })

  it('places the picture relative to that centre', () => {
    const p = layerPlan(T({ width: 400, height: 300 }), { width: 400, height: 300 })
    expect([p.dx, p.dy, p.dw, p.dh]).toEqual([-200, -150, 400, 300])
  })

  it('fits a picture of another shape inside the box', () => {
    const p = layerPlan(T({ width: 400, height: 400 }), { width: 800, height: 400 })
    expect(p.dw).toBe(400)
    expect(p.dh).toBe(200)
    expect(p.dy).toBe(-100)
  })

  it('converts degrees to radians', () => {
    expect(layerPlan(T({ rotation: 180 }), { width: 1, height: 1 }).rotation).toBeCloseTo(Math.PI)
    expect(layerPlan(T({ rotation: 90 }), { width: 1, height: 1 }).rotation).toBeCloseTo(Math.PI / 2)
  })

  it('carries the scale, including a flip', () => {
    const p = layerPlan(T({ scaleX: -1, scaleY: 0.5 }), { width: 1, height: 1 })
    expect([p.scaleX, p.scaleY]).toEqual([-1, 0.5])
  })
})

/** Records what was drawn, in order. */
function recorder() {
  const calls: unknown[][] = []
  const ctx: DrawContext = {
    fillStyle: '',
    setTransform: (...a) => { calls.push(['setTransform', ...a]) },
    fillRect: (...a) => { calls.push(['fillRect', ...a]) },
    save: () => { calls.push(['save']) },
    restore: () => { calls.push(['restore']) },
    beginPath: () => { calls.push(['beginPath']) },
    rect: (...a) => { calls.push(['rect', ...a]) },
    clip: () => { calls.push(['clip']) },
    translate: (...a) => { calls.push(['translate', ...a]) },
    rotate: (...a) => { calls.push(['rotate', ...a]) },
    scale: (...a) => { calls.push(['scale', ...a]) },
    drawImage: (img, ...a) => { calls.push(['drawImage', (img as unknown as { tag: string }).tag, ...a]) },
  }
  return { ctx, calls, names: () => calls.map((c) => c[0]) }
}

const layer = (tag: string, t: Partial<SnapshotTransform> = {}, w = 1920, h = 1080): ReadyLayer => ({
  transform: T(t), image: { tag } as unknown as CanvasImageSource, width: w, height: h,
})

const BASE = { width: 1920, height: 1080 }

describe('drawFrame', () => {
  it('clears to black first, so nothing from the last frame shows through', () => {
    const r = recorder()
    drawFrame(r.ctx, { width: 1920, height: 1080 }, BASE, [])

    expect(r.calls[0]).toEqual(['setTransform', 1, 0, 0, 1, 0, 0])
    expect(r.calls[1]).toEqual(['fillRect', 0, 0, 1920, 1080])
    expect(r.ctx.fillStyle).toBe('#000')
  })

  it('draws an empty scene as black', () => {
    const r = recorder()
    drawFrame(r.ctx, { width: 1280, height: 720 }, BASE, [])
    expect(r.names()).not.toContain('drawImage')
  })

  it('draws layers bottom first', () => {
    const r = recorder()
    drawFrame(r.ctx, BASE, BASE, [layer('bottom'), layer('middle'), layer('top')])

    const order = r.calls.filter((c) => c[0] === 'drawImage').map((c) => c[1])
    expect(order).toEqual(['bottom', 'middle', 'top'])
  })

  it('positions a layer about its centre', () => {
    const r = recorder()
    drawFrame(r.ctx, BASE, BASE, [layer('a', { x: 100, y: 50, width: 800, height: 400 }, 800, 400)])

    expect(r.calls).toContainEqual(['translate', 500, 250])
    expect(r.calls).toContainEqual(['drawImage', 'a', -400, -200, 800, 400])
  })

  it('turns and scales a layer about its centre, before drawing', () => {
    const r = recorder()
    drawFrame(r.ctx, BASE, BASE, [layer('a', { rotation: 90, scaleX: 2, scaleY: -1 })])

    const names = r.names()
    const draw = names.indexOf('drawImage')
    expect(names.indexOf('translate')).toBeLessThan(names.indexOf('rotate'))
    expect(names.indexOf('rotate')).toBeLessThan(names.indexOf('scale'))
    expect(names.indexOf('scale')).toBeLessThan(draw)
    expect(r.calls).toContainEqual(['rotate', Math.PI / 2])
    expect(r.calls).toContainEqual(['scale', 2, -1])
  })

  it('isolates each layer so one cannot disturb the next', () => {
    const r = recorder()
    drawFrame(r.ctx, BASE, BASE, [layer('a', { rotation: 45 }), layer('b')])

    // Every save has its restore.
    const saves = r.names().filter((n) => n === 'save').length
    const restores = r.names().filter((n) => n === 'restore').length
    expect(saves).toBe(restores)
    expect(saves).toBe(3) // one for the frame, one per layer
  })

  it('maps the canvas onto a smaller output', () => {
    const r = recorder()
    drawFrame(r.ctx, { width: 1280, height: 720 }, BASE, [layer('a')])

    expect(r.calls).toContainEqual(['setTransform', 2 / 3, 0, 0, 2 / 3, 0, 0])
  })

  it('keeps the canvas centred, with bars, when the output has another shape', () => {
    const r = recorder()
    drawFrame(r.ctx, { width: 1000, height: 1000 }, BASE, [layer('a')])

    const mapping = r.calls.filter((c) => c[0] === 'setTransform').at(1)!
    expect(mapping[1]).toBeCloseTo(1000 / 1920)
    expect(mapping[6]).toBeCloseTo((1000 - 1080 * (1000 / 1920)) / 2)
  })

  // The preview hides anything outside the canvas; so must the recording.
  it('clips to the base canvas before drawing any layer', () => {
    const r = recorder()
    drawFrame(r.ctx, BASE, BASE, [layer('a', { x: -500, y: -500 })])

    const names = r.names()
    expect(r.calls).toContainEqual(['rect', 0, 0, 1920, 1080])
    expect(names.indexOf('clip')).toBeLessThan(names.indexOf('drawImage'))
  })

  it('leaves the context as it found it', () => {
    const r = recorder()
    drawFrame(r.ctx, BASE, BASE, [layer('a')])
    expect(r.names().at(-1)).toBe('restore')
  })
})

describe('crop and filters', () => {
  /** Records the filter in force at each draw. */
  function filtering() {
    const seen: string[] = []
    const r = recorder()
    const draw = r.ctx.drawImage.bind(r.ctx)
    r.ctx.drawImage = ((...a: unknown[]) => { seen.push(r.ctx.filter); (draw as (...x: unknown[]) => void)(...a) }) as never
    return { r, seen }
  }

  it('draws only the cropped part, then fits that inside the box', () => {
    const r = recorder()
    const cropped: ReadyLayer = {
      ...layer('a', { width: 400, height: 200 }, 800, 400),
      width: 400, height: 400, // the picture as it will look after cropping
      crop: { sx: 200, sy: 0, sw: 400, sh: 400 },
    }
    drawFrame(r.ctx, BASE, BASE, [cropped])

    const draw = r.calls.find((c) => c[0] === 'drawImage')!
    expect(draw.slice(2, 6)).toEqual([200, 0, 400, 400]) // the source rectangle
    // A square picture in a 400 x 200 box is fitted to 200 x 200, not stretched.
    expect(draw.slice(8)).toEqual([200, 200])
  })

  it('uses the plain four-number form with no crop', () => {
    const r = recorder()
    drawFrame(r.ctx, BASE, BASE, [layer('a')])
    expect(r.calls.find((c) => c[0] === 'drawImage')).toHaveLength(6)
  })

  it('applies the filter of a layer while drawing it', () => {
    const { r, seen } = filtering()
    drawFrame(r.ctx, BASE, BASE, [{ ...layer('a'), filter: 'blur(4px)' }])
    expect(seen).toEqual(['blur(4px)'])
  })

  it('does not let the filter of one layer leak into the next', () => {
    const { r, seen } = filtering()
    r.ctx.filter = 'none'
    // The recording fake does not restore state, so emulate the real context.
    const stack: string[] = []
    const save = r.ctx.save.bind(r.ctx); const restore = r.ctx.restore.bind(r.ctx)
    r.ctx.save = () => { stack.push(r.ctx.filter); save() }
    r.ctx.restore = () => { r.ctx.filter = stack.pop() ?? 'none'; restore() }

    drawFrame(r.ctx, BASE, BASE, [{ ...layer('a'), filter: 'blur(4px)' }, layer('b')])
    expect(seen).toEqual(['blur(4px)', 'none'])
  })

  it('treats none and missing alike', () => {
    const { r, seen } = filtering()
    drawFrame(r.ctx, BASE, BASE, [{ ...layer('a'), filter: 'none' }, layer('b')])
    expect(seen).toEqual(['none', 'none'])
  })
})

describe('drawing one of two scenes in a transition', () => {
  it('paints black first by default, and not when asked to go over what is there', () => {
    const first = recorder()
    drawFrame(first.ctx, BASE, BASE, [layer('a')])
    expect(first.calls.some((c) => c[0] === 'fillRect')).toBe(true)

    const over = recorder()
    drawFrame(over.ctx, BASE, BASE, [layer('a')], { clear: false })
    expect(over.calls.some((c) => c[0] === 'fillRect')).toBe(false)
  })

  it('draws the scene at the given opacity, and puts the opacity back after', () => {
    const r = recorder()
    const alphaAtDraw: number[] = []
    const draw = r.ctx.drawImage.bind(r.ctx)
    r.ctx.drawImage = ((...a: unknown[]) => { alphaAtDraw.push(r.ctx.globalAlpha); (draw as (...x: unknown[]) => void)(...a) }) as never
    const stack: number[] = []
    const save = r.ctx.save.bind(r.ctx); const restore = r.ctx.restore.bind(r.ctx)
    r.ctx.save = () => { stack.push(r.ctx.globalAlpha); save() }
    r.ctx.restore = () => { r.ctx.globalAlpha = stack.pop() ?? 1; restore() }

    drawFrame(r.ctx, BASE, BASE, [layer('a')], { clear: false, alpha: 0.4 })
    expect(alphaAtDraw).toEqual([0.4])
    expect(r.ctx.globalAlpha).toBe(1)
  })

  it('keeps the opacity inside 0..1', () => {
    const r = recorder()
    drawFrame(r.ctx, BASE, BASE, [layer('a')], { alpha: 7 })
    drawFrame(r.ctx, BASE, BASE, [layer('a')], { alpha: -2 })
    expect(r.ctx.globalAlpha).toBeGreaterThanOrEqual(0)
    expect(r.ctx.globalAlpha).toBeLessThanOrEqual(1)
  })

  it('shifts the scene sideways without moving the edge it is clipped to', () => {
    const r = recorder()
    drawFrame(r.ctx, BASE, BASE, [layer('a')], { clear: false, offsetX: -500 })
    const names = r.names()
    expect(r.calls).toContainEqual(['translate', -500, 0])
    expect(r.calls).toContainEqual(['rect', 0, 0, 1920, 1080])
    expect(names.indexOf('clip')).toBeLessThan(names.indexOf('translate'))
  })

  it('does not shift at all by default', () => {
    const r = recorder()
    drawFrame(r.ctx, BASE, BASE, [layer('a')])
    expect(r.calls.filter((c) => c[0] === 'translate' && c[2] === 0)).toHaveLength(0)
  })

  it('shows only the uncovered part of the scene for a wipe', () => {
    const r = recorder()
    drawFrame(r.ctx, BASE, BASE, [layer('a')], { clear: false, revealWidth: 700 })
    expect(r.calls).toContainEqual(['rect', 0, 0, 700, 1080])
  })

  it.each([[-50, 0], [99999, 1920]])('keeps a reveal of %s inside the canvas', (given, expected) => {
    const r = recorder()
    drawFrame(r.ctx, BASE, BASE, [layer('a')], { revealWidth: given })
    expect(r.calls).toContainEqual(['rect', 0, 0, expected, 1080])
  })
})
