import { describe, it, expect } from 'vitest'
import { sanitizeSnapshot } from '../../electron/main/host/snapshot'

/**
 * Filters cross from the interface to the host and end up as CSS filter strings
 * and SVG. Every value is held to the range the editor offers, and anything
 * the host does not understand is dropped.
 */

const withFilters = (filters: unknown) =>
  sanitizeSnapshot({ sources: [{ id: 'a', type: 'display_capture', transform: {}, filters }] }).sources[0].filters

describe('which filters pass', () => {
  it('keeps the five kinds the editor has', () => {
    const kept = withFilters([
      { id: '1', type: 'color-correction' }, { id: '2', type: 'crop' }, { id: '3', type: 'chroma-key' },
      { id: '4', type: 'blur' }, { id: '5', type: 'sharpen' },
    ])
    expect(kept.map((f) => f.type)).toEqual(['color-correction', 'crop', 'chroma-key', 'blur', 'sharpen'])
  })

  it('keeps their order', () => {
    expect(withFilters([{ id: 'b', type: 'blur' }, { id: 'a', type: 'sharpen' }]).map((f) => f.id)).toEqual(['b', 'a'])
  })

  it.each([[{ id: 'x', type: 'drop-shadow' }], [{ id: 'x' }], [{ type: 'blur' }], [{ id: '', type: 'blur' }], [{ id: 5, type: 'blur' }], ['blur'], [null], [42]])(
    'drops %j', (bad) => expect(withFilters([bad])).toEqual([]))

  it('drops an id long enough to be an attack on the page', () => {
    expect(withFilters([{ id: 'x'.repeat(500), type: 'blur' }])).toEqual([])
  })

  it('has none when the list is missing or not a list', () => {
    expect(withFilters(undefined)).toEqual([])
    expect(withFilters('blur')).toEqual([])
    expect(withFilters({ 0: { id: 'a', type: 'blur' } })).toEqual([])
  })

  it('stops at sixteen', () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ id: `f${i}`, type: 'blur' }))
    expect(withFilters(many)).toHaveLength(16)
  })

  it('does not carry the editor-only fields', () => {
    const [f] = withFilters([{ id: 'a', type: 'blur', radius: 5, name: 'Gaussian Blur', enabled: true, extra: 'x' }])
    expect(f).toEqual({ id: 'a', type: 'blur', radius: 5 })
  })
})

describe('colour correction ranges', () => {
  const one = (over: Record<string, unknown>) =>
    withFilters([{ id: 'a', type: 'color-correction', ...over }])[0] as Record<string, number>

  it('defaults to no change', () => {
    expect(one({})).toMatchObject({ brightness: 0, contrast: 1, saturation: 1, hue: 0, opacity: 1 })
  })
  it('clamps each value to the editor range', () => {
    expect(one({ brightness: 9, contrast: 99, saturation: -3, hue: 999, opacity: 7 }))
      .toMatchObject({ brightness: 1, contrast: 4, saturation: 0, hue: 180, opacity: 1 })
  })
  it.each([NaN, Infinity, 'x', null])('uses the default for %s', (bad) => {
    expect(one({ brightness: bad }).brightness).toBe(0)
  })
})

describe('other ranges', () => {
  it('limits blur and sharpen', () => {
    expect((withFilters([{ id: 'a', type: 'blur', radius: 1e9 }])[0] as { radius: number }).radius).toBe(40)
    expect((withFilters([{ id: 'a', type: 'sharpen', strength: 99 }])[0] as { strength: number }).strength).toBe(2)
    expect((withFilters([{ id: 'a', type: 'blur', radius: -5 }])[0] as { radius: number }).radius).toBe(0)
  })

  it('keeps crop within sane amounts and never negative', () => {
    expect(withFilters([{ id: 'a', type: 'crop', left: -5, right: 1e9, top: 10, bottom: NaN }])[0])
      .toMatchObject({ left: 0, right: 16384, top: 10, bottom: 0 })
  })

  it('limits the chroma key tolerances', () => {
    expect(withFilters([{ id: 'a', type: 'chroma-key', similarity: 0, smoothness: 99999 }])[0])
      .toMatchObject({ similarity: 1, smoothness: 1000 })
  })

  it.each(['red', '#12', 'url(javascript:alert(1))', '', 5, null])('replaces the key colour %j with green', (bad) => {
    expect((withFilters([{ id: 'a', type: 'chroma-key', keyColor: bad }])[0] as { keyColor: string }).keyColor).toBe('#00ff00')
  })

  it('keeps a good key colour', () => {
    expect((withFilters([{ id: 'a', type: 'chroma-key', keyColor: '#1a2B3c' }])[0] as { keyColor: string }).keyColor).toBe('#1a2B3c')
  })
})
