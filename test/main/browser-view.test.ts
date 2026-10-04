import { describe, it, expect } from 'vitest'
import { isWebAddress, describeLoadFailure } from '../../electron/main/browser/view'

/**
 * What a hidden page may navigate to, and how a failure to load is put to the
 * user. The page is untrusted: it must not be able to leave the web.
 */

describe('isWebAddress', () => {
  it.each([['http://example.com'], ['https://example.com/a?b=c'], ['HTTPS://EXAMPLE.COM']])('allows %s', (u) => {
    expect(isWebAddress(u)).toBe(true)
  })

  it.each([
    ['file:///C:/Windows/win.ini'], ['javascript:alert(1)'], ['data:text/html,x'], ['ftp://example.com'],
    ['chrome://gpu'], ['cbmedia://media/x'], ['blob:https://example.com/1'], ['about:blank'], [''], ['example.com'],
  ])('refuses %s', (u) => {
    expect(isWebAddress(u)).toBe(false)
  })

  it('is not fooled by a web address inside another scheme', () => {
    expect(isWebAddress('javascript:void(0)//https://example.com')).toBe(false)
  })
})

describe('describeLoadFailure', () => {
  it.each([
    [-105, /could not be found/],
    [-102, /refused/],
    [-106, /no internet/i],
    [-118, /too long/],
    [-200, /certificate/],
    [-201, /certificate/],
    [-202, /certificate/],
    [-324, /closed the connection/],
  ])('explains error %s', (code, pattern) => {
    expect(describeLoadFailure(code, 'net::ERR_SOMETHING')).toMatch(pattern)
  })

  it('names the error for one it has no wording for', () => {
    expect(describeLoadFailure(-999, 'net::ERR_ODD_THING')).toBe('The page could not be loaded (ERR_ODD_THING).')
  })

  it('copes with no description', () => {
    expect(describeLoadFailure(-999, '')).toBe('The page could not be loaded.')
  })
})

import { regionWithin } from '../../electron/main/browser/view'

describe('regionWithin', () => {
  const page = { width: 100, height: 80 }

  it('keeps a rectangle that lies inside the picture', () => {
    expect(regionWithin({ x: 10, y: 20, width: 30, height: 40 }, page)).toEqual({ x: 10, y: 20, width: 30, height: 40 })
  })

  it('trims what hangs over the edges', () => {
    expect(regionWithin({ x: 90, y: 70, width: 30, height: 30 }, page)).toEqual({ x: 90, y: 70, width: 10, height: 10 })
    expect(regionWithin({ x: -10, y: -5, width: 30, height: 20 }, page)).toEqual({ x: 0, y: 0, width: 20, height: 15 })
  })

  it('rounds outward, so nothing that changed is left out', () => {
    expect(regionWithin({ x: 10.4, y: 20.6, width: 10.2, height: 5.1 }, page)).toEqual({ x: 10, y: 20, width: 11, height: 6 })
  })

  it.each([
    [{ x: 200, y: 10, width: 5, height: 5 }],
    [{ x: 10, y: 200, width: 5, height: 5 }],
    [{ x: -50, y: 0, width: 10, height: 10 }],
    [{ x: 10, y: 10, width: 0, height: 5 }],
    [{ x: 10, y: 10, width: 5, height: -3 }],
    [{ x: NaN, y: 0, width: 5, height: 5 }],
  ])('is nothing for %j', (rect) => {
    expect(regionWithin(rect, page)).toBeNull()
  })

  it('takes the whole picture', () => {
    expect(regionWithin({ x: 0, y: 0, width: 100, height: 80 }, page)).toEqual({ x: 0, y: 0, width: 100, height: 80 })
  })
})

import { restrictToWeb } from '../../electron/main/browser/view'

describe('restrictToWeb', () => {
  function guard() {
    const listeners: Record<string, (e: { preventDefault(): void }, url: string) => void> = {}
    restrictToWeb({ on: (event, listener) => { listeners[event] = listener } })
    const attempt = (event: 'will-navigate' | 'will-redirect', url: string) => {
      let blocked = false
      listeners[event]({ preventDefault: () => { blocked = true } }, url)
      return blocked
    }
    return { listeners, attempt }
  }

  it('watches both links and redirects', () => {
    expect(Object.keys(guard().listeners).sort()).toEqual(['will-navigate', 'will-redirect'])
  })

  it.each(['will-navigate', 'will-redirect'] as const)('lets a page go on to a web address (%s)', (event) => {
    expect(guard().attempt(event, 'https://example.com/next')).toBe(false)
  })

  it.each(['will-navigate', 'will-redirect'] as const)('stops a page leaving the web (%s)', (event) => {
    const { attempt } = guard()
    expect(attempt(event, 'file:///C:/Windows/win.ini')).toBe(true)
    expect(attempt(event, 'javascript:alert(1)')).toBe(true)
    expect(attempt(event, 'cbmedia://media/anything')).toBe(true)
  })
})
