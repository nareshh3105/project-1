import { describe, it, expect } from 'vitest'
import { easeInOut, transitionProgress, transitionFrame } from '../../src/host/transition'

/**
 * The recording and the preview must move at the same pace, so the easing has to
 * be CSS ease-in-out, and a transition must never run backwards or past its end.
 */

describe('easeInOut', () => {
  it('starts at 0 and ends at 1', () => {
    expect(easeInOut(0)).toBe(0)
    expect(easeInOut(1)).toBe(1)
  })

  it('is half way at half time', () => {
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 3)
  })

  // Values of CSS cubic-bezier(0.42, 0, 0.58, 1), solved independently, so the preview and recording agree.
  it.each([[0.1, 0.0197], [0.25, 0.1292], [0.75, 0.8708], [0.9, 0.9803]])('matches the CSS curve at %s', (p, expected) => {
    expect(easeInOut(p)).toBeCloseTo(expected, 3)
  })

  it('starts slowly and ends slowly', () => {
    expect(easeInOut(0.1)).toBeLessThan(0.1)
    expect(easeInOut(0.9)).toBeGreaterThan(0.9)
  })

  it('never goes backwards', () => {
    let last = -1
    for (let p = 0; p <= 1.0001; p += 0.01) {
      const e = easeInOut(p)
      expect(e).toBeGreaterThanOrEqual(last)
      last = e
    }
  })

  it.each([[-5, 0], [7, 1], [NaN, 0]])('keeps %s inside 0..1', (given, expected) => {
    expect(easeInOut(given)).toBe(expected)
  })
})

describe('transitionProgress', () => {
  it('runs from 0 to 1 over the duration', () => {
    expect(transitionProgress(1000, 1000, 400)).toBe(0)
    expect(transitionProgress(1200, 1000, 400)).toBe(0.5)
    expect(transitionProgress(1400, 1000, 400)).toBe(1)
  })

  it('stays at 1 once over', () => {
    expect(transitionProgress(99_999, 1000, 400)).toBe(1)
  })

  it('stays at 0 if the start is a little in the future', () => {
    expect(transitionProgress(990, 1000, 400)).toBe(0)
  })

  it.each([[0], [-10], [NaN]])('is over at once for a duration of %s', (d) => {
    expect(transitionProgress(1000, 1000, d)).toBe(1)
  })

  it('is over for a start time that is not a number', () => {
    expect(transitionProgress(1000, NaN, 400)).toBe(1)
  })
})

describe('transitionFrame', () => {
  const W = 1920

  it('fades the incoming scene in', () => {
    expect(transitionFrame('fade', 0, W)).toEqual({ fromOffsetX: 0, toOffsetX: 0, toAlpha: 0, toRevealWidth: null })
    expect(transitionFrame('fade', 0.25, W).toAlpha).toBe(0.25)
    expect(transitionFrame('fade', 1, W).toAlpha).toBe(1)
  })

  it('slides both scenes left, the new one entering from the right', () => {
    expect(transitionFrame('slide', 0, W)).toMatchObject({ fromOffsetX: -0, toOffsetX: W, toAlpha: 1 })
    const half = transitionFrame('slide', 0.5, W)
    expect(half.fromOffsetX).toBe(-960)
    expect(half.toOffsetX).toBe(960)
    expect(transitionFrame('slide', 1, W)).toMatchObject({ fromOffsetX: -W, toOffsetX: 0 })
  })

  it('keeps the two scenes edge to edge as they slide', () => {
    for (const e of [0, 0.2, 0.5, 0.8, 1]) {
      const f = transitionFrame('slide', e, W)
      expect(f.toOffsetX - f.fromOffsetX).toBeCloseTo(W, 6)
    }
  })

  it('uncovers the incoming scene from the left edge', () => {
    expect(transitionFrame('wipe', 0, W).toRevealWidth).toBe(0)
    expect(transitionFrame('wipe', 0.5, W).toRevealWidth).toBe(960)
    expect(transitionFrame('wipe', 1, W).toRevealWidth).toBe(W)
    expect(transitionFrame('wipe', 0.5, W).toAlpha).toBe(1)
  })

  it('keeps the amount inside 0..1', () => {
    expect(transitionFrame('fade', -1, W).toAlpha).toBe(0)
    expect(transitionFrame('fade', 9, W).toAlpha).toBe(1)
    expect(transitionFrame('wipe', 9, W).toRevealWidth).toBe(W)
  })
})
