import { describe, it, expect } from 'vitest'
import { planFilters, croppedArea, hexToRgb, filterDomId, hasCrop, cropViewBox, NO_CROP } from '../../src/lib/filters/plan'
import type { SnapshotFilter } from '../../shared/host'

/**
 * One plan drives the preview and the recording, so what the plan says is what
 * the user gets. Pure strings and numbers, tested directly.
 */

const cc = (over: Partial<Extract<SnapshotFilter, { type: 'color-correction' }>> = {}): SnapshotFilter =>
  ({ id: 'cc1', type: 'color-correction', brightness: 0, contrast: 1, saturation: 1, hue: 0, opacity: 1, ...over })

describe('nothing to do', () => {
  it('gives none for no filters', () => {
    expect(planFilters([])).toEqual({ css: 'none', defs: '', crop: NO_CROP })
  })

  it('gives none for filters that change nothing', () => {
    expect(planFilters([cc()]).css).toBe('none')
    expect(planFilters([{ id: 'b', type: 'blur', radius: 0 }]).css).toBe('none')
    expect(planFilters([{ id: 's', type: 'sharpen', strength: 0 }]).css).toBe('none')
  })
})

describe('color correction', () => {
  it('becomes CSS functions, only for what changed', () => {
    expect(planFilters([cc({ brightness: 0.5 })]).css).toBe('brightness(1.5)')
    expect(planFilters([cc({ contrast: 2, saturation: 0 })]).css).toBe('contrast(2) saturate(0)')
    expect(planFilters([cc({ hue: 90, opacity: 0.5 })]).css).toBe('hue-rotate(90deg) opacity(0.5)')
  })

  it('keeps every value inside a range the browser accepts', () => {
    expect(planFilters([cc({ brightness: 50 })]).css).toBe('brightness(3)')
    expect(planFilters([cc({ brightness: -50 })]).css).toBe('brightness(0)')
    expect(planFilters([cc({ contrast: 99 })]).css).toBe('contrast(4)')
    expect(planFilters([cc({ hue: 900 })]).css).toBe('hue-rotate(180deg)')
    expect(planFilters([cc({ opacity: 5 })]).css).toBe('none')
  })

  it.each([NaN, Infinity, 'x' as never])('ignores a value of %s', (bad) => {
    expect(planFilters([cc({ brightness: bad })]).css).toBe('none')
  })
})

describe('blur', () => {
  it('is in pixels of the finished picture, so it follows the scale', () => {
    expect(planFilters([{ id: 'b', type: 'blur', radius: 10 }]).css).toBe('blur(10px)')
    expect(planFilters([{ id: 'b', type: 'blur', radius: 10 }], 0.5).css).toBe('blur(5px)')
  })

  it('has an upper limit', () => {
    expect(planFilters([{ id: 'b', type: 'blur', radius: 9999 }]).css).toBe('blur(40px)')
  })
})

describe('sharpen', () => {
  const plan = planFilters([{ id: 'sh-1', type: 'sharpen', strength: 0.5 }])

  it('refers to its own SVG filter', () => {
    expect(plan.css).toBe('url(#cbf-sh-1)')
    expect(plan.defs).toContain('id="cbf-sh-1"')
  })

  it('uses a kernel whose weights sum to one, so brightness is unchanged', () => {
    const kernel = /kernelMatrix="([^"]+)"/.exec(plan.defs)![1].split(' ').map(Number)
    expect(kernel).toHaveLength(9)
    expect(kernel.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 4)
    expect(kernel[4]).toBeCloseTo(3, 4) // 1 + 4 * 0.5
  })

  it('works in sRGB, not linear light', () => {
    expect(plan.defs).toContain('color-interpolation-filters="sRGB"')
  })
})

describe('chroma key', () => {
  const plan = planFilters([{ id: 'k1', type: 'chroma-key', keyColor: '#00ff00', similarity: 80, smoothness: 50, opacity: 1 }])

  it('refers to its own SVG filter', () => {
    expect(plan.css).toBe('url(#cbf-k1)')
    expect(plan.defs).toContain('<filter id="cbf-k1"')
  })

  it('measures distance from the key colour on each channel', () => {
    // Green key: R and B offsets of 0.5, G offset of 0.5 - 0.5*1 = 0.
    expect(plan.defs).toContain('0.5 0 0 0 0.5 0 0.5 0 0 0 0 0 0.5 0 0.5 0 0 0 0 1')
  })

  it('folds the difference so distance has no sign, on all three colour channels', () => {
    expect(plan.defs.match(/tableValues="1 0 1"/g)).toHaveLength(3)
  })

  it('masks the picture rather than recolouring it', () => {
    expect(plan.defs).toContain('operator="in"')
    expect(plan.defs).toContain('in="SourceGraphic" in2="mask"')
  })

  it('ramps wider for a larger smoothness', () => {
    const gainOf = (s: number) => {
      const d = planFilters([{ id: 'k', type: 'chroma-key', keyColor: '#00ff00', similarity: 80, smoothness: s, opacity: 1 }]).defs
      return Number(/values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ([\d.]+) /.exec(d)![1])
    }
    expect(gainOf(10)).toBeGreaterThan(gainOf(200))
  })

  it('moves the threshold with similarity', () => {
    const offsetOf = (s: number) => {
      const d = planFilters([{ id: 'k', type: 'chroma-key', keyColor: '#00ff00', similarity: s, smoothness: 50, opacity: 1 }]).defs
      return Number(/values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 [\d.]+ [\d.]+ [\d.]+ 0 (-?[\d.]+)"/.exec(d)![1])
    }
    expect(offsetOf(300)).toBeLessThan(offsetOf(50))
  })

  it('adds opacity after the key', () => {
    expect(planFilters([{ id: 'k', type: 'chroma-key', keyColor: '#00ff00', similarity: 80, smoothness: 50, opacity: 0.5 }]).css)
      .toBe('url(#cbf-k) opacity(0.5)')
  })

  it('does not trust a key colour that is not a colour', () => {
    const d = planFilters([{ id: 'k', type: 'chroma-key', keyColor: 'url(javascript:1)', similarity: 80, smoothness: 50, opacity: 1 }]).defs
    expect(d).not.toContain('javascript')
  })
})

describe('crop', () => {
  it('is not a filter: it comes back as geometry', () => {
    const plan = planFilters([{ id: 'c', type: 'crop', left: 10, right: 20, top: 30, bottom: 40 }])
    expect(plan.crop).toEqual({ left: 10, right: 20, top: 30, bottom: 40 })
    expect(plan.css).toBe('none')
  })

  it('adds up when there are several', () => {
    const plan = planFilters([
      { id: 'a', type: 'crop', left: 10, right: 0, top: 0, bottom: 0 },
      { id: 'b', type: 'crop', left: 5, right: 0, top: 7, bottom: 0 },
    ])
    expect(plan.crop).toEqual({ left: 15, right: 0, top: 7, bottom: 0 })
  })

  it('ignores negative and non-numeric amounts', () => {
    expect(planFilters([{ id: 'c', type: 'crop', left: -50, right: NaN, top: 'x' as never, bottom: 2.6 }]).crop)
      .toEqual({ left: 0, right: 0, top: 0, bottom: 3 })
  })

  it('knows whether anything is cut', () => {
    expect(hasCrop(NO_CROP)).toBe(false)
    expect(hasCrop({ ...NO_CROP, top: 1 })).toBe(true)
  })
})

describe('croppedArea', () => {
  it('is what is left of the picture', () => {
    expect(croppedArea(1920, 1080, { left: 100, right: 200, top: 10, bottom: 20 })).toEqual({ sx: 100, sy: 10, sw: 1620, sh: 1050 })
  })

  it('is the whole picture with no crop', () => {
    expect(croppedArea(640, 360, NO_CROP)).toEqual({ sx: 0, sy: 0, sw: 640, sh: 360 })
  })

  it('is nothing when the crop leaves nothing, so the caller draws it uncropped', () => {
    expect(croppedArea(100, 100, { left: 60, right: 60, top: 0, bottom: 0 })).toBeNull()
    expect(croppedArea(100, 100, { left: 0, right: 0, top: 100, bottom: 0 })).toBeNull()
  })
})

describe('order', () => {
  it('applies filters in the order given', () => {
    const plan = planFilters([
      { id: 'b', type: 'blur', radius: 2 },
      cc({ brightness: 0.5 }),
      { id: 's', type: 'sharpen', strength: 1 },
    ])
    expect(plan.css).toBe('blur(2px) brightness(1.5) url(#cbf-s)')
  })
})

describe('helpers', () => {
  it('parses short and long hex', () => {
    expect(hexToRgb('#fff')).toEqual([1, 1, 1])
    expect(hexToRgb('#ff0000')).toEqual([1, 0, 0])
  })
  it.each(['red', '#ggg', '', 'url(x)'])('falls back to green for %s', (bad) => expect(hexToRgb(bad)).toEqual([0, 1, 0]))

  it('strips anything unsafe from an id', () => {
    expect(filterDomId('a b"><script>')).toBe('cbf-abscript')
    expect(filterDomId('ok-1_x')).toBe('cbf-ok-1_x')
  })
})

describe('cropViewBox', () => {
  it('is nothing without a crop', () => {
    expect(cropViewBox(NO_CROP, 1920, 1080)).toBeUndefined()
  })

  it('gives each edge as a share of the picture, in CSS order (top right bottom left)', () => {
    expect(cropViewBox({ left: 192, right: 96, top: 108, bottom: 54 }, 1920, 1080)).toBe('inset(10% 5% 5% 10%)')
  })

  it('shows the whole picture when the crop would leave nothing', () => {
    expect(cropViewBox({ left: 1000, right: 1000, top: 0, bottom: 0 }, 1920, 1080)).toBeUndefined()
  })

  it.each([[0, 100], [100, 0], [NaN, 100]])('copes with a picture of %s by %s that has not loaded', (w, h) => {
    expect(cropViewBox({ ...NO_CROP, top: 10 }, w, h)).toBeUndefined()
  })
})
