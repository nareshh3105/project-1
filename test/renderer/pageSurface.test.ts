import { describe, it, expect, beforeEach, vi } from 'vitest'
import { paintUpdate, isPaintable } from '../../src/lib/sources/pageSurface'
import type { PageUpdate } from '../../shared/host'

/**
 * A page sends only what changed, and the canvas holds the rest. A changed region
 * must replace what was there, not blend with it, and the picture handed to the
 * browser for the purpose must always be let go of.
 */

const update = (over: Partial<PageUpdate> = {}): PageUpdate => ({
  width: 100, height: 80, x: 10, y: 20, w: 30, h: 40, bgra: new Uint8Array(30 * 40 * 4), ...over,
})

let calls: unknown[][]
let closed: number
let made: Array<{ data: unknown; init: Record<string, unknown> }>

beforeEach(() => {
  calls = []; closed = 0; made = []
  vi.stubGlobal('VideoFrame', class {
    constructor(public data: unknown, public init: Record<string, unknown>) { made.push({ data, init }) }
    close() { closed++ }
  })
})

const ctx = () => ({
  clearRect: (...a: unknown[]) => { calls.push(['clearRect', ...a]) },
  drawImage: (_img: unknown, ...a: unknown[]) => { calls.push(['drawImage', ...a]) },
})

describe('paintUpdate', () => {
  it('clears the region and then draws the new picture there, so it replaces what was there', () => {
    paintUpdate(ctx(), update())
    expect(calls).toEqual([['clearRect', 10, 20, 30, 40], ['drawImage', 10, 20]])
  })

  it('reads the bytes as raw blue-green-red-alpha pixels of the size of the region', () => {
    const u = update()
    paintUpdate(ctx(), u)
    expect(made[0].data).toBe(u.bgra)
    expect(made[0].init).toMatchObject({ format: 'BGRA', codedWidth: 30, codedHeight: 40 })
  })

  it('lets go of the picture it made', () => {
    paintUpdate(ctx(), update())
    expect(closed).toBe(1)
  })

  it('lets go of it even if drawing fails', () => {
    const failing = { clearRect: () => {}, drawImage: () => { throw new Error('lost context') } }
    expect(() => paintUpdate(failing, update())).toThrow('lost context')
    expect(closed).toBe(1)
  })
})

describe('isPaintable', () => {
  it('accepts a region that fits the page', () => {
    expect(isPaintable(update())).toBe(true)
  })

  it('accepts the whole page', () => {
    expect(isPaintable(update({ x: 0, y: 0, w: 100, h: 80, bgra: new Uint8Array(100 * 80 * 4) }))).toBe(true)
  })

  it.each([
    ['runs off the right', { x: 80 }],
    ['runs off the bottom', { y: 50 }],
    ['starts before the page', { x: -1 }],
    ['has the wrong number of bytes', { bgra: new Uint8Array(7) }],
    ['has no width', { w: 0, bgra: new Uint8Array(0) }],
    ['is for a page with no size', { width: 0 }],
  ] as Array<[string, Partial<PageUpdate>]>)('refuses a region that %s', (_why, over) => {
    expect(isPaintable(update(over))).toBe(false)
  })
})
