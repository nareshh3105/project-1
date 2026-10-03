import { describe, it, expect } from 'vitest'
import {
  moveBy, resizeBy, arrowStep, toCanvas, isCorner, HANDLES, MIN_SIZE,
  type Placement, type Handle,
} from '../../src/lib/canvas/geometry'

const box: Placement = { x: 100, y: 200, width: 400, height: 300 }

const right = (p: Placement) => p.x + p.width
const bottom = (p: Placement) => p.y + p.height

describe('moveBy', () => {
  it('moves by the given distance', () => {
    expect(moveBy(box, 30, -20)).toEqual({ x: 130, y: 180 })
  })

  it('works from where the drag began, not from the last move', () => {
    // Two events from the same start give absolute positions, so rounding or a
    // dropped event cannot accumulate into drift.
    expect(moveBy(box, 10, 10)).toEqual({ x: 110, y: 210 })
    expect(moveBy(box, 25, 5)).toEqual({ x: 125, y: 205 })
  })

  it('stores whole canvas pixels', () => {
    expect(moveBy(box, 10.6, 3.4)).toEqual({ x: 111, y: 203 })
  })

  it('allows a source to leave the canvas', () => {
    expect(moveBy(box, -500, 0).x).toBe(-400)
  })

  it('does nothing for a zero drag', () => {
    expect(moveBy(box, 0, 0)).toEqual({ x: 100, y: 200 })
  })
})

describe('resizeBy: edges', () => {
  it('east grows the right edge only', () => {
    expect(resizeBy(box, 'e', 50, 999)).toEqual({ x: 100, y: 200, width: 450, height: 300 })
  })

  it('west moves the left edge and keeps the right', () => {
    const r = resizeBy(box, 'w', -40, 999)
    expect(r.x).toBe(60)
    expect(right(r)).toBe(right(box))
    expect(r.height).toBe(300)
  })

  it('north moves the top edge and keeps the bottom', () => {
    const r = resizeBy(box, 'n', 0, -25)
    expect(r.y).toBe(175)
    expect(bottom(r)).toBe(bottom(box))
    expect(r.width).toBe(400)
  })

  it('south grows the bottom edge only', () => {
    expect(resizeBy(box, 's', 999, 60)).toEqual({ x: 100, y: 200, width: 400, height: 360 })
  })

  it('ignores the keep-aspect option, since an edge has one axis', () => {
    expect(resizeBy(box, 'e', 50, 0, { keepAspect: true })).toEqual(resizeBy(box, 'e', 50, 0))
  })
})

describe('resizeBy: corners', () => {
  it('moves both axes freely by default', () => {
    expect(resizeBy(box, 'se', 40, 10)).toEqual({ x: 100, y: 200, width: 440, height: 310 })
  })

  it('northwest moves the origin and keeps the opposite corner', () => {
    const r = resizeBy(box, 'nw', -20, -10)
    expect(r).toEqual({ x: 80, y: 190, width: 420, height: 310 })
    expect(right(r)).toBe(right(box))
    expect(bottom(r)).toBe(bottom(box))
  })

  it('northeast keeps the bottom-left corner', () => {
    const r = resizeBy(box, 'ne', 30, -30)
    expect(r.x).toBe(box.x)
    expect(bottom(r)).toBe(bottom(box))
  })

  it('southwest keeps the top-right corner', () => {
    const r = resizeBy(box, 'sw', -30, 30)
    expect(right(r)).toBe(right(box))
    expect(r.y).toBe(box.y)
  })
})

describe('resizeBy: keeping proportions', () => {
  const ratio = (p: Placement) => p.width / p.height

  it('scales both sides together', () => {
    const r = resizeBy(box, 'se', 80, 0, { keepAspect: true })
    expect(r.width).toBe(480)
    expect(r.height).toBe(360)
    expect(ratio(r)).toBeCloseTo(ratio(box), 2)
  })

  it('follows the vertical movement when that is the larger one', () => {
    const r = resizeBy(box, 'se', 0, 150, { keepAspect: true })
    expect(r.height).toBe(450)
    expect(r.width).toBe(600)
  })

  it('keeps the opposite corner fixed for every corner', () => {
    const anchors: Record<string, (p: Placement) => [number, number]> = {
      nw: (p) => [right(p), bottom(p)],
      ne: (p) => [p.x, bottom(p)],
      sw: (p) => [right(p), p.y],
      se: (p) => [p.x, p.y],
    }
    for (const corner of ['nw', 'ne', 'sw', 'se'] as Handle[]) {
      const r = resizeBy(box, corner, 37, -23, { keepAspect: true })
      expect(anchors[corner](r)).toEqual(anchors[corner](box))
    }
  })

  it('shrinks when dragged toward the anchor', () => {
    const r = resizeBy(box, 'se', -100, -75, { keepAspect: true })
    expect(r.width).toBe(300)
    expect(r.height).toBe(225)
  })
})

describe('minimum size', () => {
  it('stops an edge at the minimum instead of inverting', () => {
    const r = resizeBy(box, 'e', -10_000, 0)
    expect(r.width).toBe(MIN_SIZE)
    expect(r.x).toBe(box.x)
  })

  it('stops the west edge at the minimum, anchored to the right edge', () => {
    const r = resizeBy(box, 'w', 10_000, 0)
    expect(r.width).toBe(MIN_SIZE)
    expect(right(r)).toBe(right(box))
  })

  it('stops the north edge at the minimum, anchored to the bottom', () => {
    const r = resizeBy(box, 'n', 0, 10_000)
    expect(r.height).toBe(MIN_SIZE)
    expect(bottom(r)).toBe(bottom(box))
  })

  it('applies to proportional resizing too, by the smaller side', () => {
    const r = resizeBy(box, 'se', -10_000, -10_000, { keepAspect: true })
    expect(Math.min(r.width, r.height)).toBeGreaterThanOrEqual(MIN_SIZE)
    expect(r.width / r.height).toBeCloseTo(box.width / box.height, 1)
  })

  it('never produces a size below the minimum from any handle', () => {
    for (const h of HANDLES) {
      for (const keepAspect of [false, true]) {
        const r = resizeBy(box, h, -9999, -9999, { keepAspect })
        const s = resizeBy(box, h, 9999, 9999, { keepAspect })
        expect(r.width).toBeGreaterThanOrEqual(MIN_SIZE)
        expect(r.height).toBeGreaterThanOrEqual(MIN_SIZE)
        expect(s.width).toBeGreaterThanOrEqual(MIN_SIZE)
        expect(s.height).toBeGreaterThanOrEqual(MIN_SIZE)
      }
    }
  })
})

describe('resizeBy: general properties', () => {
  it('is a no-op for a zero drag, from any handle', () => {
    for (const h of HANDLES) {
      expect(resizeBy(box, h, 0, 0)).toEqual(box)
      expect(resizeBy(box, h, 0, 0, { keepAspect: true })).toEqual(box)
    }
  })

  it('always returns whole pixels', () => {
    for (const h of HANDLES) {
      const r = resizeBy(box, h, 13.7, -9.2, { keepAspect: true })
      for (const v of Object.values(r)) expect(Number.isInteger(v)).toBe(true)
    }
  })

  it('leaves the anchor edge alone for every handle', () => {
    for (const h of HANDLES) {
      const r = resizeBy(box, h, 41, -17)
      if (h.includes('e')) expect(r.x).toBe(box.x)
      if (h.includes('w')) expect(right(r)).toBe(right(box))
      if (h.includes('s')) expect(r.y).toBe(box.y)
      if (h.includes('n')) expect(bottom(r)).toBe(bottom(box))
    }
  })
})

describe('isCorner', () => {
  it('tells corners from edges', () => {
    expect(HANDLES.filter(isCorner)).toEqual(['nw', 'ne', 'se', 'sw'])
  })
})

describe('arrowStep', () => {
  it('moves one pixel, or ten with Shift', () => {
    expect(arrowStep('ArrowRight', false)).toEqual({ dx: 1, dy: 0 })
    expect(arrowStep('ArrowLeft', true)).toEqual({ dx: -10, dy: 0 })
    expect(arrowStep('ArrowUp', false)).toEqual({ dx: 0, dy: -1 })
    expect(arrowStep('ArrowDown', true)).toEqual({ dx: 0, dy: 10 })
  })
})

describe('toCanvas', () => {
  // The canvas is drawn at a fraction of its size to fit the panel; at half
  // size, 50 screen pixels is 100 canvas pixels.
  it('undoes the display scale', () => {
    expect(toCanvas(50, 0.5)).toBe(100)
    expect(toCanvas(50, 2)).toBe(25)
    expect(toCanvas(50, 1)).toBe(50)
  })

  it.each([0, -1, NaN, Infinity])('yields no movement for an unusable scale (%s)', (scale) => {
    expect(toCanvas(50, scale)).toBe(0)
  })
})
