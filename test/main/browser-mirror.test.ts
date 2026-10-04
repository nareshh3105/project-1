import { describe, it, expect } from 'vitest'
import { PageMirror } from '../../electron/main/browser/mirror'
import type { PageUpdate } from '../../shared/host'

/**
 * The main process keeps the whole picture of a page from the regions it paints,
 * so that a window that starts watching later can be given all of it. A bad
 * region must never corrupt it.
 */

/** A region whose every pixel has the same blue value, `fill`. */
const region = (width: number, height: number, x: number, y: number, w: number, h: number, fill: number): PageUpdate => ({
  width, height, x, y, w, h, bgra: new Uint8Array(w * h * 4).fill(fill),
})
const pixel = (m: PageMirror, x: number, y: number) => {
  const whole = m.whole()!
  return whole.bgra[(y * whole.width + x) * 4]
}

describe('PageMirror', () => {
  it('has nothing before the page has painted', () => {
    expect(new PageMirror().whole()).toBeNull()
  })

  it('holds the whole page after its first picture', () => {
    const m = new PageMirror()
    expect(m.apply(region(8, 6, 0, 0, 8, 6, 7))).toBe(true)
    const whole = m.whole()!
    expect([whole.width, whole.height, whole.x, whole.y, whole.w, whole.h]).toEqual([8, 6, 0, 0, 8, 6])
    expect(whole.bgra).toHaveLength(8 * 6 * 4)
    expect(pixel(m, 3, 3)).toBe(7)
  })

  it('puts a changed region where it belongs, leaving the rest alone', () => {
    const m = new PageMirror()
    m.apply(region(8, 6, 0, 0, 8, 6, 1))
    m.apply(region(8, 6, 2, 1, 3, 2, 9))

    expect(pixel(m, 2, 1)).toBe(9)
    expect(pixel(m, 4, 2)).toBe(9)
    expect(pixel(m, 1, 1)).toBe(1) // just left of it
    expect(pixel(m, 5, 1)).toBe(1) // just right
    expect(pixel(m, 2, 0)).toBe(1) // just above
    expect(pixel(m, 2, 3)).toBe(1) // just below
  })

  it('places each row of a region correctly', () => {
    const m = new PageMirror()
    m.apply(region(4, 4, 0, 0, 4, 4, 0))
    // A 2 x 2 region whose pixels are 1, 2 then 3, 4.
    const bgra = new Uint8Array(16)
    const values = [1, 2, 3, 4]
    values.forEach((v, i) => { bgra[i * 4] = v })
    m.apply({ width: 4, height: 4, x: 1, y: 2, w: 2, h: 2, bgra })
    expect([pixel(m, 1, 2), pixel(m, 2, 2), pixel(m, 1, 3), pixel(m, 2, 3)]).toEqual([1, 2, 3, 4])
  })

  it('takes a region at the very edge', () => {
    const m = new PageMirror()
    m.apply(region(8, 6, 0, 0, 8, 6, 1))
    expect(m.apply(region(8, 6, 6, 4, 2, 2, 5))).toBe(true)
    expect(pixel(m, 7, 5)).toBe(5)
  })

  it('keeps its own copy, because the sender reuses its buffer', () => {
    const m = new PageMirror()
    const first = region(4, 4, 0, 0, 4, 4, 1)
    m.apply(first)
    first.bgra.fill(99)
    expect(pixel(m, 0, 0)).toBe(1)
  })

  describe('a region that cannot be used', () => {
    const bad: Array<[string, PageUpdate]> = [
      ['runs off the right edge', region(8, 6, 7, 0, 2, 2, 5)],
      ['runs off the bottom', region(8, 6, 0, 5, 2, 2, 5)],
      ['starts left of the page', { ...region(8, 6, 0, 0, 2, 2, 5), x: -1 }],
      ['has too few bytes', { ...region(8, 6, 0, 0, 2, 2, 5), bgra: new Uint8Array(3) }],
      ['has too many bytes', { ...region(8, 6, 0, 0, 2, 2, 5), bgra: new Uint8Array(99) }],
      ['has no area', { ...region(8, 6, 0, 0, 2, 2, 5), w: 0, bgra: new Uint8Array(0) }],
      ['is for a page with no size', region(0, 0, 0, 0, 2, 2, 5)],
      ['has a fractional position', { ...region(8, 6, 0, 0, 2, 2, 5), x: 0.5 }],
      ['has a position that is not a number', { ...region(8, 6, 0, 0, 2, 2, 5), x: NaN }],
    ]

    it.each(bad)('is refused when it %s, and changes nothing', (_why, update) => {
      const m = new PageMirror()
      m.apply(region(8, 6, 0, 0, 8, 6, 1))
      expect(m.apply(update)).toBe(false)
      expect(m.whole()!.bgra.every((v) => v === 1)).toBe(true)
    })
  })

  describe('when the page changes size', () => {
    it('starts again from the whole of the new page', () => {
      const m = new PageMirror()
      m.apply(region(8, 6, 0, 0, 8, 6, 1))
      expect(m.apply(region(4, 3, 0, 0, 4, 3, 2))).toBe(true)
      expect(m.whole()!.width).toBe(4)
      expect(m.whole()!.bgra.every((v) => v === 2)).toBe(true)
    })

    it('refuses a part of the new page before the whole of it, and keeps the old picture', () => {
      const m = new PageMirror()
      m.apply(region(8, 6, 0, 0, 8, 6, 1))
      expect(m.apply(region(4, 3, 1, 1, 2, 2, 2))).toBe(false)
      expect(m.whole()!.width).toBe(8)
    })

    it('refuses a part of a page as the very first thing', () => {
      const m = new PageMirror()
      expect(m.apply(region(8, 6, 1, 1, 2, 2, 2))).toBe(false)
      expect(m.whole()).toBeNull()
    })
  })
})
