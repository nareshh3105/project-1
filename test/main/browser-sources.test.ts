import { describe, it, expect, beforeEach } from 'vitest'
import {
  BrowserSources, normalizeSpec, LIMITS, DEFAULT_SPEC, type BrowserDeps, type BrowserSpec, type PageView,
} from '../../electron/main/browser/sources'
import type { PageUpdate } from '../../shared/host'

/**
 * A browser source runs an untrusted web page. What may be loaded, how large and
 * fast it may be, and how it is shared between the preview and the recorder are
 * decided here.
 */

describe('which addresses may be used', () => {
  const url = (u: unknown) => normalizeSpec({ url: u }).url

  it.each([
    ['https://example.com/overlay', 'https://example.com/overlay'],
    ['http://localhost:3000/alerts', 'http://localhost:3000/alerts'],
    ['  https://example.com  ', 'https://example.com/'],
  ])('accepts %s', (given, expected) => expect(url(given)).toBe(expected))

  it('reads a bare address as a secure web address', () => {
    expect(url('example.com/widget')).toBe('https://example.com/widget')
  })

  it.each([
    ['file:///C:/Windows/win.ini'],
    ['javascript:alert(1)'],
    ['data:text/html,<script>1</script>'],
    ['ftp://example.com/x'],
    ['chrome://gpu'],
    ['about:blank'],
    ['cbmedia://media/abc'],
    ['blob:https://example.com/x'],
  ])('refuses %s', (bad) => {
    expect(() => normalizeSpec({ url: bad })).toThrow(/Only web addresses|not a valid/)
  })

  it.each([[undefined], [null], [''], ['   '], [42], [{}]])('asks for an address when given %s', (bad) => {
    expect(() => normalizeSpec({ url: bad })).toThrow(/Enter the address/)
  })

  it('refuses an address that cannot be read', () => {
    expect(() => normalizeSpec({ url: 'http://' })).toThrow(/not a valid/)
  })

  it('refuses an absurdly long address', () => {
    expect(() => normalizeSpec({ url: `https://example.com/${'a'.repeat(LIMITS.urlLength)}` })).toThrow(/too long/)
  })
})

describe('the size and speed of a page', () => {
  const spec = (over: Record<string, unknown> = {}) => normalizeSpec({ url: 'https://example.com', ...over })

  it('has defaults', () => {
    expect(spec()).toMatchObject(DEFAULT_SPEC)
  })

  it('keeps sensible choices', () => {
    expect(spec({ width: 1920, height: 1080, fps: 60 })).toMatchObject({ width: 1920, height: 1080, fps: 60 })
  })

  it('keeps a page within what memory can hold', () => {
    expect(spec({ width: 99999, height: 99999 })).toMatchObject({ width: LIMITS.side.max, height: LIMITS.side.max })
    expect(spec({ width: 1, height: -5 })).toMatchObject({ width: LIMITS.side.min, height: LIMITS.side.min })
  })

  it('keeps the speed within a rate that makes sense', () => {
    expect(spec({ fps: 1000 }).fps).toBe(LIMITS.fps.max)
    expect(spec({ fps: 0 }).fps).toBe(LIMITS.fps.min)
  })

  it.each([[NaN], [Infinity], ['big'], [null]])('uses the default for a size of %s', (bad) => {
    expect(spec({ width: bad, fps: bad }).width).toBe(DEFAULT_SPEC.width)
    expect(spec({ fps: bad }).fps).toBe(DEFAULT_SPEC.fps)
  })

  it('rounds to whole pixels', () => {
    expect(spec({ width: 800.6 }).width).toBe(801)
  })
})

describe('BrowserSources', () => {
  class FakeView implements PageView {
    frame: ((u: PageUpdate) => void) | null = null
    failure: ((m: string) => void) | null = null
    destroyed = false
    reloads = 0
    constructor(readonly spec: BrowserSpec) {}
    onFrame(cb: (u: PageUpdate) => void) { this.frame = cb }
    onFailure(cb: (m: string) => void) { this.failure = cb }
    reload() { this.reloads++ }
    destroy() { this.destroyed = true }
  }

  let views: FakeView[]
  let sent: Array<{ to: number; id: string; w: number; h: number; bytes: number }>
  let failures: Array<{ to: number; id: string; message: string }>
  let sources: BrowserSources

  beforeEach(() => {
    views = []; sent = []; failures = []
    const deps: BrowserDeps = {
      createView: (spec) => { const v = new FakeView(spec); views.push(v); return v },
      sendFrame: (to, id, u) => { sent.push({ to, id, w: u.w, h: u.h, bytes: u.bgra.length }) },
      sendFailure: (to, id, message) => { failures.push({ to, id, message }) },
    }
    sources = new BrowserSources(deps)
  })

  const attach = (win: number, id = 'a', url = 'https://example.com/x', extra: Record<string, unknown> = {}) =>
    sources.attach(win, id, { url, ...extra })
  /** The whole of a page that is w by h. */
  const paint = (view: FakeView, w = 2, h = 2) => view.frame!({ width: w, height: h, x: 0, y: 0, w, h, bgra: new Uint8Array(w * h * 4) })

  describe('showing a page', () => {
    it('opens a page for a window that asks', () => {
      attach(1)
      expect(views).toHaveLength(1)
      expect(views[0].spec.url).toBe('https://example.com/x')
    })

    it('sends each picture to the window showing it', () => {
      attach(1)
      paint(views[0], 4, 3)
      expect(sent).toEqual([{ to: 1, id: 'a', w: 4, h: 3, bytes: 48 }])
    })

    it('keeps one page for several windows, and sends to all of them', () => {
      attach(1); attach(2)
      expect(views).toHaveLength(1)
      paint(views[0])
      expect(sent.map((s) => s.to).sort()).toEqual([1, 2])
    })

    it('gives a window that arrives late the whole picture, not just the last change', () => {
      attach(1)
      paint(views[0], 8, 6)
      views[0].frame!({ width: 8, height: 6, x: 6, y: 4, w: 2, h: 2, bgra: new Uint8Array(16) })
      sent.length = 0
      attach(2)
      expect(sent).toEqual([{ to: 2, id: 'a', w: 8, h: 6, bytes: 8 * 6 * 4 }])
    })

    it('sends only the part that changed to windows already watching', () => {
      attach(1)
      paint(views[0], 8, 6)
      sent.length = 0
      views[0].frame!({ width: 8, height: 6, x: 6, y: 4, w: 2, h: 2, bgra: new Uint8Array(16) })
      expect(sent).toEqual([{ to: 1, id: 'a', w: 2, h: 2, bytes: 16 }])
    })

    it('does not send a region that cannot be used', () => {
      attach(1)
      paint(views[0], 8, 6)
      sent.length = 0
      views[0].frame!({ width: 8, height: 6, x: 7, y: 5, w: 4, h: 4, bgra: new Uint8Array(64) })
      views[0].frame!({ width: 8, height: 6, x: 0, y: 0, w: 2, h: 2, bgra: new Uint8Array(3) })
      expect(sent).toEqual([])
    })

    it('gives pages for different sources their own windows', () => {
      attach(1, 'a'); attach(1, 'b', 'https://example.org')
      expect(views).toHaveLength(2)
      paint(views[1])
      expect(sent.map((s) => s.id)).toEqual(['b'])
    })

    it('returns what was understood, so the caller sees the checked values', () => {
      expect(sources.attach(1, 'a', { url: 'example.com', width: 99999 })).toMatchObject({
        url: 'https://example.com/', width: LIMITS.side.max,
      })
    })

    it.each([[undefined], [''], [5], [null]])('refuses a source named %s', (id) => {
      expect(() => sources.attach(1, id, { url: 'https://example.com' })).toThrow(/Missing source/)
    })

    it('refuses an address that may not be loaded, and opens nothing', () => {
      expect(() => attach(1, 'a', 'file:///C:/secret.txt')).toThrow(/Only web addresses/)
      expect(views).toHaveLength(0)
      expect(sources.count).toBe(0)
    })

    it('refuses more pages than memory could take', () => {
      for (let i = 0; i < LIMITS.pages; i++) attach(1, `s${i}`)
      expect(() => attach(1, 'one-too-many')).toThrow(/No more than/)
      expect(sources.count).toBe(LIMITS.pages)
    })

    it('still lets an existing page be changed when the limit is reached', () => {
      for (let i = 0; i < LIMITS.pages; i++) attach(1, `s${i}`)
      expect(() => attach(1, 's0', 'https://example.org')).not.toThrow()
    })
  })

  describe('changing a page', () => {
    it('does not restart it for the same request again', () => {
      attach(1); attach(1); attach(2)
      expect(views).toHaveLength(1)
    })

    it('starts afresh for a different address, closing the old page', () => {
      attach(1)
      attach(1, 'a', 'https://example.org')
      expect(views).toHaveLength(2)
      expect(views[0].destroyed).toBe(true)
    })

    it('starts afresh for a different size or speed', () => {
      attach(1, 'a', 'https://example.com/x', { width: 800 })
      attach(1, 'a', 'https://example.com/x', { width: 900 })
      attach(1, 'a', 'https://example.com/x', { width: 900, fps: 10 })
      expect(views).toHaveLength(3)
    })

    it('keeps every window that was watching watching the new page', () => {
      attach(1); attach(2)
      attach(1, 'a', 'https://example.org')
      paint(views[1])
      expect(sent.map((s) => s.to).sort()).toEqual([1, 2])
    })

    it('ignores pictures from the page it replaced', () => {
      attach(1)
      const old = views[0]
      attach(1, 'a', 'https://example.org')
      sent.length = 0
      paint(old)
      expect(sent).toEqual([])
    })
  })

  describe('closing', () => {
    it('keeps the page while any window still shows it', () => {
      attach(1); attach(2)
      sources.detach(1, 'a')
      expect(views[0].destroyed).toBe(false)
      sources.detach(2, 'a')
      expect(views[0].destroyed).toBe(true)
      expect(sources.count).toBe(0)
    })

    it('stops sending to a window that stopped watching', () => {
      attach(1); attach(2)
      sources.detach(1, 'a')
      paint(views[0])
      expect(sent.map((s) => s.to)).toEqual([2])
    })

    it('forgets everything a closed window was showing', () => {
      attach(1, 'a'); attach(1, 'b', 'https://example.org'); attach(2, 'a')
      sources.detachAll(1)
      expect(views[0].destroyed).toBe(false) // window 2 still shows a
      expect(views[1].destroyed).toBe(true)
    })

    it('is harmless for a page that is not there', () => {
      expect(() => sources.detach(1, 'nothing')).not.toThrow()
      expect(() => sources.detach(1, undefined)).not.toThrow()
    })

    it('closes everything on shutdown', () => {
      attach(1, 'a'); attach(1, 'b', 'https://example.org')
      sources.shutdown()
      expect(views.every((v) => v.destroyed)).toBe(true)
      expect(sources.count).toBe(0)
    })

    it('can open the same source again afterwards', () => {
      attach(1)
      sources.detach(1, 'a')
      attach(1)
      expect(views).toHaveLength(2)
    })
  })

  describe('trouble', () => {
    it('tells the windows showing a page when it cannot be loaded', () => {
      attach(1); attach(2)
      views[0].failure!('This page could not be reached.')
      expect(failures.map((f) => f.to).sort()).toEqual([1, 2])
      expect(failures[0].message).toMatch(/could not be reached/)
    })

    it('tells a window that arrives later', () => {
      attach(1)
      views[0].failure!('Blocked.')
      failures.length = 0
      attach(2)
      expect(failures).toEqual([{ to: 2, id: 'a', message: 'Blocked.' }])
    })

    it('forgets the trouble once the page paints', () => {
      attach(1)
      views[0].failure!('Blocked.')
      paint(views[0])
      failures.length = 0
      attach(2)
      expect(failures).toEqual([])
    })

    it('can reload a page', () => {
      attach(1)
      sources.reload('a')
      expect(views[0].reloads).toBe(1)
      expect(() => sources.reload('missing')).not.toThrow()
    })
  })
})
