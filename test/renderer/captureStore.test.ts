// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { installBridge, removeBridge, type BridgeStub } from '../mocks/bridge'
import type { CaptureTarget } from '../../src/lib/capture/target'

/**
 * Starting a capture. Without a display-media handler in the main process,
 * getDisplayMedia fails outright on Windows, so the store has to declare what
 * it wants first and only then ask for it.
 */

let bridge: BridgeStub
let useCaptureStore: typeof import('../../src/stores/captureStore')['useCaptureStore']

const SCREEN: CaptureTarget = { kind: 'screen', id: 'screen:0:0', name: 'Entire screen' }
const WINDOW: CaptureTarget = { kind: 'window', id: 'window:5:0', name: 'Notepad' }
const CAMERA: CaptureTarget = { kind: 'camera', id: 'cam-1', name: 'Webcam' }

const live = (id: string, name: string, kind: 'screen' | 'window') =>
  ({ id, name, kind, thumbnail: null, icon: null })

interface FakeStream {
  stream: MediaStream
  track: { stop: ReturnType<typeof vi.fn>; addEventListener: ReturnType<typeof vi.fn> }
  fireEnded: () => void
}

function fakeStream(): FakeStream {
  let onEnded: (() => void) | undefined
  const track = {
    stop: vi.fn(),
    addEventListener: vi.fn((event: string, cb: () => void) => { if (event === 'ended') onEnded = cb }),
  }
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream
  return { stream, track, fireEnded: () => onEnded?.() }
}

let getDisplayMedia: ReturnType<typeof vi.fn>
let getUserMedia: ReturnType<typeof vi.fn>
let enumerateDevices: ReturnType<typeof vi.fn>
/** How many bridge calls had happened when the browser was asked for a stream. */
let callsWhenRequested: number

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  bridge = installBridge()
  callsWhenRequested = -1

  const display = fakeStream()
  getDisplayMedia = vi.fn(async () => {
    callsWhenRequested = bridge.calls.length
    return display.stream
  })
  getUserMedia = vi.fn(async () => fakeStream().stream)
  enumerateDevices = vi.fn(async () => [
    { kind: 'videoinput', deviceId: 'cam-1', label: 'Webcam' },
    { kind: 'audioinput', deviceId: 'mic-1', label: 'Mic' },
  ])
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getDisplayMedia, getUserMedia, enumerateDevices },
    configurable: true,
  })

  bridge.reply('list_capture_sources', [
    live('screen:0:0', 'Entire screen', 'screen'),
    live('window:5:0', 'Notepad', 'window'),
  ])

  useCaptureStore = (await import('../../src/stores/captureStore')).useCaptureStore
})

afterEach(() => removeBridge())

const state = () => useCaptureStore.getState()
const prepared = () => bridge.calls.filter((c) => c.command === 'prepare_capture')

describe('capturing a screen or window', () => {
  it('starts and reports the source as live', async () => {
    await state().startCapture('s1', 'display_capture', SCREEN)

    expect(state().activeIds).toContain('s1')
    expect(state().getStream('s1')).toBeDefined()
    expect(state().errors.s1).toBeUndefined()
  })

  // The refusal is the point: Electron grants a capture only to a choice made
  // just beforehand, so the order is what makes it work.
  it('declares what it wants before asking the browser for it', async () => {
    await state().startCapture('s1', 'display_capture', SCREEN)

    const prepareIndex = bridge.calls.findIndex((c) => c.command === 'prepare_capture')
    expect(prepareIndex).toBeGreaterThanOrEqual(0)
    expect(prepareIndex).toBeLessThan(callsWhenRequested)
  })

  it('declares the screen that was chosen, without system audio', async () => {
    await state().startCapture('s1', 'display_capture', SCREEN)

    expect(prepared()).toHaveLength(1)
    expect(prepared()[0].args).toEqual({ sourceId: 'screen:0:0', audio: false })
  })

  it('looks only among screens for a screen, and windows for a window', async () => {
    await state().startCapture('s1', 'display_capture', SCREEN)
    await state().startCapture('w1', 'window_capture', WINDOW)

    const lists = bridge.calls.filter((c) => c.command === 'list_capture_sources').map((c) => c.args.kinds)
    expect(lists).toEqual([['screen'], ['window']])
  })

  // A window gets a new id every time it opens, so a saved id goes stale.
  it('finds a window by title when its id has changed', async () => {
    bridge.reply('list_capture_sources', [live('window:99:0', 'Notepad', 'window')])

    await state().startCapture('w1', 'window_capture', WINDOW)

    expect(prepared()[0].args.sourceId).toBe('window:99:0')
    expect(state().activeIds).toContain('w1')
  })

  it('treats game capture as capturing a window', async () => {
    await state().startCapture('g1', 'game_capture', WINDOW)
    expect(state().activeIds).toContain('g1')
  })
})

describe('when it cannot capture', () => {
  it('asks the user to choose when there is no target, without touching the browser', async () => {
    await state().startCapture('s1', 'display_capture', null)

    expect(state().errors.s1).toBe('Choose what to capture.')
    expect(getDisplayMedia).not.toHaveBeenCalled()
    expect(state().activeIds).not.toContain('s1')
  })

  it('says which window is not open', async () => {
    bridge.reply('list_capture_sources', [])

    await state().startCapture('w1', 'window_capture', WINDOW)

    expect(state().errors.w1).toBe('"Notepad" is not open.')
    expect(getDisplayMedia).not.toHaveBeenCalled()
  })

  // Quietly capturing a different monitor would be worse than saying so.
  it('does not substitute another screen for a missing one', async () => {
    bridge.reply('list_capture_sources', [live('screen:1:0', 'Screen 2', 'screen')])

    await state().startCapture('s1', 'display_capture', SCREEN)

    expect(state().errors.s1).toContain('not available')
    expect(prepared()).toHaveLength(0)
  })

  it('reports a refusal from the browser', async () => {
    getDisplayMedia.mockRejectedValueOnce(Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }))

    await state().startCapture('s1', 'display_capture', SCREEN)

    expect(state().errors.s1).toBe('Permission denied')
    expect(state().activeIds).not.toContain('s1')
  })

  it('reports a failure to list sources', async () => {
    bridge.fail('list_capture_sources', 'desktop capturer unavailable')

    await state().startCapture('s1', 'display_capture', SCREEN)

    expect(state().errors.s1).toContain('desktop capturer unavailable')
  })

  it('clears an earlier error once it succeeds', async () => {
    await state().startCapture('s1', 'display_capture', null)
    expect(state().errors.s1).toBeDefined()

    await state().startCapture('s1', 'display_capture', SCREEN)

    expect(state().errors.s1).toBeUndefined()
  })
})

describe('cameras', () => {
  it('opens the chosen device by id, without involving the screen broker', async () => {
    await state().startCapture('c1', 'dshow_video', CAMERA)

    expect(getUserMedia).toHaveBeenCalledWith({ video: { deviceId: { exact: 'cam-1' } }, audio: false })
    expect(getDisplayMedia).not.toHaveBeenCalled()
    expect(prepared()).toHaveLength(0)
    expect(state().activeIds).toContain('c1')
  })

  it('says when the camera is not connected', async () => {
    enumerateDevices.mockResolvedValueOnce([])

    await state().startCapture('c1', 'dshow_video', CAMERA)

    expect(state().errors.c1).toContain('Webcam')
    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it('does not open a different camera in its place', async () => {
    enumerateDevices.mockResolvedValueOnce([{ kind: 'videoinput', deviceId: 'other', label: 'Other' }])

    await state().startCapture('c1', 'dshow_video', CAMERA)

    expect(getUserMedia).not.toHaveBeenCalled()
  })
})

describe('lifecycle', () => {
  it('stops the stream and clears the source when told to', async () => {
    await state().startCapture('s1', 'display_capture', SCREEN)
    const stream = state().getStream('s1')!
    const [track] = stream.getTracks() as unknown as { stop: ReturnType<typeof vi.fn> }[]

    state().stopCapture('s1')

    expect(track.stop).toHaveBeenCalled()
    expect(state().activeIds).not.toContain('s1')
    expect(state().getStream('s1')).toBeUndefined()
  })

  it('releases the previous stream when a source is restarted', async () => {
    const first = fakeStream()
    getDisplayMedia.mockResolvedValueOnce(first.stream)
    await state().startCapture('s1', 'display_capture', SCREEN)

    await state().startCapture('s1', 'display_capture', SCREEN)

    expect(first.track.stop).toHaveBeenCalled()
    expect(state().activeIds.filter((id) => id === 's1')).toHaveLength(1)
  })

  // The user clicking "Stop sharing", or the window closing.
  it('marks the source as no longer live when the stream ends by itself', async () => {
    const ended = fakeStream()
    getDisplayMedia.mockResolvedValueOnce(ended.stream)
    await state().startCapture('s1', 'display_capture', SCREEN)
    expect(state().activeIds).toContain('s1')

    ended.fireEnded()

    expect(state().activeIds).not.toContain('s1')
  })

  it('stops everything at once', async () => {
    await state().startCapture('a', 'display_capture', SCREEN)
    await state().startCapture('b', 'window_capture', WINDOW)

    state().stopAll()

    expect(state().activeIds).toEqual([])
  })
})
