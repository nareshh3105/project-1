import { describe, it, expect } from 'vitest'
import { fitWithin } from '../../src/lib/sources/placement'

const CANVAS = { width: 1920, height: 1080 }

describe('fitWithin', () => {
  it('shows a small picture at its own size, centred', () => {
    expect(fitWithin({ width: 400, height: 200 }, CANVAS)).toEqual({ width: 400, height: 200, x: 760, y: 440 })
  })

  it('never scales a small picture up', () => {
    expect(fitWithin({ width: 10, height: 10 }, CANVAS).width).toBe(10)
  })

  it('shrinks a wide picture to the canvas width, keeping its shape', () => {
    const b = fitWithin({ width: 3840, height: 1080 }, CANVAS)
    expect(b).toEqual({ width: 1920, height: 540, x: 0, y: 270 })
  })

  it('shrinks a tall picture to the canvas height, keeping its shape', () => {
    const b = fitWithin({ width: 1000, height: 4320 }, CANVAS)
    expect(b.height).toBe(1080)
    expect(b.width / b.height).toBeCloseTo(1000 / 4320, 2)
    expect(b.y).toBe(0)
  })

  it('fills a canvas-sized picture exactly', () => {
    expect(fitWithin(CANVAS, CANVAS)).toEqual({ x: 0, y: 0, width: 1920, height: 1080 })
  })

  it.each([[0, 100], [100, 0], [-5, 5], [NaN, 100]])('copes with a picture of %s by %s', (w, h) => {
    const b = fitWithin({ width: w, height: h }, CANVAS)
    expect(b.width).toBeGreaterThan(0)
    expect(b.height).toBeGreaterThan(0)
  })

  it('keeps a huge picture on the canvas', () => {
    const b = fitWithin({ width: 100_000, height: 100_000 }, CANVAS)
    expect(b.x).toBeGreaterThanOrEqual(0)
    expect(b.x + b.width).toBeLessThanOrEqual(1920)
    expect(b.y + b.height).toBeLessThanOrEqual(1080)
  })
})
