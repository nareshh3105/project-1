import { describe, it, expect, beforeEach } from 'vitest'
import {
  CaptureBroker, CHOICE_TTL_MS, kindOf, type RawSource, type CaptureKind,
} from '../../electron/main/capture/broker'

/**
 * Without a display-media handler, getDisplayMedia fails on Windows with
 * "NotSupportedError: Not supported", so screen and window capture could not
 * work at all. The broker is what lets the handler grant a capture, and its
 * most important property is what it refuses: nothing is granted unless the
 * user has just chosen it.
 */

const image = (empty = false, url = 'data:image/png;base64,AAAA') => ({
  isEmpty: () => empty,
  toDataURL: () => url,
})

const screen = (id: string, name: string): RawSource => ({
  id, name, thumbnail: image(), appIcon: null,
})

const win = (id: string, name: string, opts: Partial<RawSource> = {}): RawSource => ({
  id, name, thumbnail: image(), appIcon: image(false, 'data:image/png;base64,ICON'), ...opts,
})

let available: RawSource[]
let clock: number
let asked: CaptureKind[][]
let broker: CaptureBroker

beforeEach(() => {
  available = [
    screen('screen:0:0', 'Entire screen'),
    screen('screen:1:0', 'Screen 2'),
    win('window:11:0', 'Notepad'),
    win('window:12:0', 'Game'),
  ]
  clock = 1_000_000
  asked = []
  broker = new CaptureBroker(
    async (kinds) => {
      asked.push(kinds)
      return available.filter((s) => kinds.includes(kindOf(s.id)))
    },
    () => clock,
  )
})

describe('listing sources', () => {
  it('reports each with its kind', async () => {
    const list = await broker.listSources()
    expect(list.map((s) => [s.id, s.kind])).toEqual([
      ['screen:0:0', 'screen'], ['screen:1:0', 'screen'],
      ['window:11:0', 'window'], ['window:12:0', 'window'],
    ])
  })

  it('can be limited to screens or to windows', async () => {
    expect((await broker.listSources(['screen'])).every((s) => s.kind === 'screen')).toBe(true)
    expect((await broker.listSources(['window'])).every((s) => s.kind === 'window')).toBe(true)
  })

  it('passes thumbnails and window icons as data URLs', async () => {
    const [, , notepad] = await broker.listSources()
    expect(notepad.thumbnail).toBe('data:image/png;base64,AAAA')
    expect(notepad.icon).toBe('data:image/png;base64,ICON')
  })

  it('reports no thumbnail when the system could not make one', async () => {
    available = [win('window:1:0', 'Minimized', { thumbnail: image(true) })]
    const [only] = await broker.listSources()
    expect(only.thumbnail).toBeNull()
  })

  it('has no icon for a screen', async () => {
    const [first] = await broker.listSources(['screen'])
    expect(first.icon).toBeNull()
  })

  // Untitled windows are helper surfaces nobody would pick on purpose.
  it('leaves out windows with no title, but never screens', async () => {
    available = [screen('screen:0:0', ''), win('window:1:0', '   '), win('window:2:0', 'Real')]
    const list = await broker.listSources()
    expect(list.map((s) => s.id)).toEqual(['screen:0:0', 'window:2:0'])
  })
})

describe('granting a capture', () => {
  it('grants the source that was prepared', async () => {
    broker.prepare('window:11:0')
    const grant = await broker.resolve()
    expect(grant?.video.id).toBe('window:11:0')
  })

  it('grants a screen as well as a window', async () => {
    broker.prepare('screen:1:0')
    expect((await broker.resolve())?.video.id).toBe('screen:1:0')
  })

  it('adds system audio only when it was asked for', async () => {
    broker.prepare('screen:0:0', false)
    expect((await broker.resolve())?.audio).toBeUndefined()

    broker.prepare('screen:0:0', true)
    expect((await broker.resolve())?.audio).toBe('loopback')
  })

  it('only looks in the kind of source that was chosen', async () => {
    broker.prepare('window:11:0')
    await broker.resolve()
    expect(asked.at(-1)).toEqual(['window'])
  })
})

describe('refusing', () => {
  // The property that matters: a page cannot capture the screen on its own.
  it('refuses a request when nothing was prepared', async () => {
    expect(await broker.resolve()).toBeNull()
  })

  it('uses a choice once', async () => {
    broker.prepare('screen:0:0')
    expect(await broker.resolve()).not.toBeNull()
    expect(await broker.resolve()).toBeNull()
  })

  it('refuses a choice that has expired', async () => {
    broker.prepare('screen:0:0')
    clock += CHOICE_TTL_MS + 1
    expect(await broker.resolve()).toBeNull()
  })

  it('still honours a choice just inside the limit', async () => {
    broker.prepare('screen:0:0')
    clock += CHOICE_TTL_MS
    expect(await broker.resolve()).not.toBeNull()
  })

  it('refuses a source that has gone away since it was chosen', async () => {
    broker.prepare('window:11:0')
    available = available.filter((s) => s.id !== 'window:11:0')
    expect(await broker.resolve()).toBeNull()
  })

  it('does not fall back to another source', async () => {
    broker.prepare('window:99:0')
    expect(await broker.resolve()).toBeNull()
  })

  it('spends the choice even when it cannot be honoured', async () => {
    broker.prepare('window:99:0')
    await broker.resolve()
    available.push(win('window:99:0', 'Late arrival'))
    expect(await broker.resolve()).toBeNull()
  })

  it('refuses to prepare an empty choice', () => {
    expect(() => broker.prepare('')).toThrow()
  })

  it('lets a later choice replace an earlier one', async () => {
    broker.prepare('screen:0:0')
    broker.prepare('screen:1:0')
    expect((await broker.resolve())?.video.id).toBe('screen:1:0')
  })
})

describe('kindOf', () => {
  it('tells screens from windows by id', () => {
    expect(kindOf('screen:0:0')).toBe('screen')
    expect(kindOf('window:5:0')).toBe('window')
  })
})

describe('several windows at once', () => {
  // The interface and the output host both open captures, sometimes together.
  it('keeps the choice of each window apart', async () => {
    broker.prepare('screen:1:0', false, 1)
    broker.prepare('window:11:0', false, 2)

    expect((await broker.resolve(2))?.video.id).toBe('window:11:0')
    expect((await broker.resolve(1))?.video.id).toBe('screen:1:0')
  })

  it('does not let one window use the choice of another', async () => {
    broker.prepare('screen:1:0', false, 1)

    expect(await broker.resolve(2)).toBeNull()
    // And the owner still has theirs.
    expect((await broker.resolve(1))?.video.id).toBe('screen:1:0')
  })

  it('replaces only an earlier choice from the same window', async () => {
    broker.prepare('screen:0:0', false, 1)
    broker.prepare('screen:1:0', false, 2)
    broker.prepare('window:11:0', false, 1)

    expect((await broker.resolve(1))?.video.id).toBe('window:11:0')
    expect((await broker.resolve(2))?.video.id).toBe('screen:1:0')
  })
})
