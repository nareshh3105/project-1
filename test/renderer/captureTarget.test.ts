import { describe, it, expect } from 'vitest'
import {
  targetKindFor, parseCaptureTarget, withCaptureTarget, resolveTarget, missingMessage,
  type CaptureTarget,
} from '../../src/lib/capture/target'

describe('targetKindFor', () => {
  it.each([
    ['display_capture', 'screen'],
    ['window_capture', 'window'],
    ['game_capture', 'window'],
    ['dshow_video', 'camera'],
  ] as const)('%s captures a %s', (type, kind) => {
    expect(targetKindFor(type)).toBe(kind)
  })

  it.each(['image', 'text_gdi_plus', 'color_source', 'browser_source', 'wasapi_input', 'scene'] as const)(
    '%s has no capture target',
    (type) => expect(targetKindFor(type)).toBeNull(),
  )
})

describe('parseCaptureTarget', () => {
  const good = { kind: 'window', id: 'window:5:0', name: 'Notepad' }

  it('reads a saved target', () => {
    expect(parseCaptureTarget({ capture: good })).toEqual(good)
  })

  it('is null when nothing was saved', () => {
    expect(parseCaptureTarget({})).toBeNull()
    expect(parseCaptureTarget(undefined)).toBeNull()
  })

  // Settings are stored as JSON and can be anything.
  it.each([
    ['null', null],
    ['a string', 'screen:0:0'],
    ['a number', 7],
    ['an array', []],
    ['an unknown kind', { ...good, kind: 'printer' }],
    ['a missing id', { kind: 'screen', name: 'x' }],
    ['an empty id', { ...good, id: '' }],
    ['a non-string id', { ...good, id: 12 }],
  ])('rejects %s', (_label, value) => {
    expect(parseCaptureTarget({ capture: value })).toBeNull()
  })

  it('tolerates a missing or odd name', () => {
    expect(parseCaptureTarget({ capture: { kind: 'screen', id: 'screen:0:0' } })?.name).toBe('')
    expect(parseCaptureTarget({ capture: { kind: 'screen', id: 'screen:0:0', name: 5 } })?.name).toBe('')
  })
})

describe('withCaptureTarget', () => {
  const target: CaptureTarget = { kind: 'screen', id: 'screen:1:0', name: 'Screen 2' }

  it('records the target', () => {
    expect(parseCaptureTarget(withCaptureTarget({}, target))).toEqual(target)
  })

  it('keeps the other settings', () => {
    expect(withCaptureTarget({ other: 1 }, target).other).toBe(1)
  })

  it('replaces an earlier target', () => {
    const first = withCaptureTarget({}, { kind: 'screen', id: 'screen:0:0', name: 'A' })
    expect(parseCaptureTarget(withCaptureTarget(first, target))).toEqual(target)
  })

  it('does not modify what it was given', () => {
    const settings = { a: 1 }
    withCaptureTarget(settings, target)
    expect(settings).toEqual({ a: 1 })
  })
})

describe('resolveTarget', () => {
  it('finds a screen by id', () => {
    const screens = [{ id: 'screen:0:0', name: 'Entire screen' }, { id: 'screen:1:0', name: 'Screen 2' }]
    expect(resolveTarget({ kind: 'screen', id: 'screen:1:0', name: 'Screen 2' }, screens)?.id).toBe('screen:1:0')
  })

  // Capturing the wrong monitor quietly is worse than reporting a missing one.
  it('does not substitute another screen when the saved one is gone', () => {
    const screens = [{ id: 'screen:0:0', name: 'Entire screen' }]
    expect(resolveTarget({ kind: 'screen', id: 'screen:1:0', name: 'Screen 2' }, screens)).toBeNull()
  })

  it('does not match a screen by name', () => {
    const screens = [{ id: 'screen:0:0', name: 'Screen 2' }]
    expect(resolveTarget({ kind: 'screen', id: 'screen:1:0', name: 'Screen 2' }, screens)).toBeNull()
  })

  it('finds a window by id when nothing has restarted', () => {
    const windows = [{ id: 'window:5:0', name: 'Notepad' }]
    expect(resolveTarget({ kind: 'window', id: 'window:5:0', name: 'Notepad' }, windows)?.id).toBe('window:5:0')
  })

  // A window's id changes every time it is opened, so after a restart the saved
  // id is stale and the title is the only thing left to go on.
  it('finds a window by title when its id has changed', () => {
    const windows = [{ id: 'window:99:0', name: 'Notepad' }, { id: 'window:7:0', name: 'Other' }]
    expect(resolveTarget({ kind: 'window', id: 'window:5:0', name: 'Notepad' }, windows)?.id).toBe('window:99:0')
  })

  it('prefers the id over a title that now belongs to another window', () => {
    const windows = [{ id: 'window:5:0', name: 'Notepad' }, { id: 'window:6:0', name: 'Notepad' }]
    expect(resolveTarget({ kind: 'window', id: 'window:6:0', name: 'Notepad' }, windows)?.id).toBe('window:6:0')
  })

  it('is null when the window is no longer open', () => {
    expect(resolveTarget({ kind: 'window', id: 'window:5:0', name: 'Notepad' }, [])).toBeNull()
  })

  it('does not match a window with no saved title', () => {
    const windows = [{ id: 'window:9:0', name: '' }]
    expect(resolveTarget({ kind: 'window', id: 'window:5:0', name: '' }, windows)).toBeNull()
  })

  it('finds a camera by device id', () => {
    const cams = [{ id: 'abc', name: 'Webcam' }]
    expect(resolveTarget({ kind: 'camera', id: 'abc', name: 'Webcam' }, cams)?.id).toBe('abc')
  })

  it('does not swap in a different camera', () => {
    const cams = [{ id: 'xyz', name: 'Webcam' }]
    expect(resolveTarget({ kind: 'camera', id: 'abc', name: 'Webcam' }, cams)).toBeNull()
  })
})

describe('missingMessage', () => {
  it('says which window is not open', () => {
    expect(missingMessage({ kind: 'window', id: 'w', name: 'Notepad' })).toBe('"Notepad" is not open.')
  })

  it('says which camera is not connected', () => {
    expect(missingMessage({ kind: 'camera', id: 'c', name: 'Webcam' })).toContain('Webcam')
  })

  it('suggests a disconnected screen', () => {
    expect(missingMessage({ kind: 'screen', id: 's', name: 'Screen 2' })).toContain('disconnected')
  })

  it('copes with an unnamed target', () => {
    expect(missingMessage({ kind: 'window', id: 'w', name: '' })).toContain('selected source')
  })
})
