// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { installBridge, removeBridge, type BridgeStub } from '../mocks/bridge'
import type { SourceDto } from '../../src/ipc'

/**
 * A camera or screen takes a moment to open. If its source is removed (or the
 * capture started again) meanwhile, the stream that arrives has no source to
 * stop it, and the camera light stayed on with nothing on screen to turn it off.
 */

let bridge: BridgeStub
let useSourceStore: typeof import('../../src/stores/sourceStore')['useSourceStore']
let useCaptureStore: typeof import('../../src/stores/captureStore')['useCaptureStore']

const CAMERA = { kind: 'camera' as const, id: 'cam-1', name: 'Webcam' }

function fakeStream() {
  const listeners: Record<string, () => void> = {}
  const track = { stop: vi.fn(), addEventListener: (e: string, cb: () => void) => { listeners[e] = cb } }
  return {
    track, listeners,
    stream: { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream,
  }
}

/** A camera that opens when the test says so. */
function slowCameras() {
  const pending: Array<{ resolve: (s: MediaStream) => void; reject: (e: unknown) => void }> = []
  ;(navigator.mediaDevices as unknown as Record<string, unknown>).enumerateDevices =
    async () => [{ kind: 'videoinput', deviceId: 'cam-1', label: 'Webcam' }]
  ;(navigator.mediaDevices as unknown as Record<string, unknown>).getUserMedia = vi.fn(
    () => new Promise<MediaStream>((resolve, reject) => pending.push({ resolve, reject })),
  )
  return pending
}

const nextTick = () => new Promise((r) => setTimeout(r, 0))

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  bridge = installBridge()
  Object.defineProperty(navigator, 'mediaDevices', { value: {}, configurable: true })
  useSourceStore = (await import('../../src/stores/sourceStore')).useSourceStore
  useCaptureStore = (await import('../../src/stores/captureStore')).useCaptureStore
  useSourceStore.getState().seedSources('s1', [{
    id: 'a', sceneId: 's1', name: 'Cam', sourceType: 'dshow_video', settings: '{}', orderIndex: 0,
    visible: true, locked: false, muted: false, volume: 1, transform: '{}', createdAt: 0, updatedAt: 0,
  } as SourceDto])
})

afterEach(() => removeBridge())

describe('a camera that is still opening', () => {
  it('is switched off when it arrives after its source was removed', async () => {
    const pending = slowCameras()
    const started = useCaptureStore.getState().startCapture('a', 'dshow_video', CAMERA)
    await nextTick()

    await useSourceStore.getState().removeSource('s1', 'a')
    const cam = fakeStream()
    pending[0].resolve(cam.stream)
    await started

    expect(cam.track.stop).toHaveBeenCalled()
    expect(useCaptureStore.getState().activeIds).toEqual([])
    expect(useCaptureStore.getState().getStream('a')).toBeUndefined()
  })

  it('is switched off when it arrives after everything was stopped', async () => {
    const pending = slowCameras()
    const started = useCaptureStore.getState().startCapture('a', 'dshow_video', CAMERA)
    await nextTick()

    useCaptureStore.getState().stopAll()
    const cam = fakeStream()
    pending[0].resolve(cam.stream)
    await started

    expect(cam.track.stop).toHaveBeenCalled()
    expect(useCaptureStore.getState().activeIds).toEqual([])
  })

  it('leaves only the newest of two starts running', async () => {
    const pending = slowCameras()
    const first = useCaptureStore.getState().startCapture('a', 'dshow_video', CAMERA)
    await nextTick()
    const second = useCaptureStore.getState().startCapture('a', 'dshow_video', CAMERA)
    await nextTick()

    const older = fakeStream()
    const newer = fakeStream()
    pending[1].resolve(newer.stream)
    await second
    pending[0].resolve(older.stream)
    await first

    expect(older.track.stop).toHaveBeenCalled()
    expect(newer.track.stop).not.toHaveBeenCalled()
    expect(useCaptureStore.getState().getStream('a')).toBe(newer.stream)
    expect(useCaptureStore.getState().activeIds).toEqual(['a'])
  })

  it('does the same when the newer start is the one that arrives last', async () => {
    const pending = slowCameras()
    const first = useCaptureStore.getState().startCapture('a', 'dshow_video', CAMERA)
    await nextTick()
    const second = useCaptureStore.getState().startCapture('a', 'dshow_video', CAMERA)
    await nextTick()

    const older = fakeStream()
    const newer = fakeStream()
    pending[0].resolve(older.stream)
    await first
    pending[1].resolve(newer.stream)
    await second

    expect(older.track.stop).toHaveBeenCalled()
    expect(newer.track.stop).not.toHaveBeenCalled()
    expect(useCaptureStore.getState().getStream('a')).toBe(newer.stream)
  })

  it('does not report the failure of a start that was replaced', async () => {
    const pending = slowCameras()
    const first = useCaptureStore.getState().startCapture('a', 'dshow_video', CAMERA)
    await nextTick()
    await useSourceStore.getState().removeSource('s1', 'a')

    pending[0].reject(new Error('Device in use'))
    await first

    expect(useCaptureStore.getState().errors).toEqual({})
  })

  it('still reports the failure of the current start', async () => {
    const pending = slowCameras()
    const started = useCaptureStore.getState().startCapture('a', 'dshow_video', CAMERA)
    await nextTick()

    pending[0].reject(new Error('Device in use'))
    await started

    expect(useCaptureStore.getState().errors['a']).toBe('Device in use')
  })
})

describe('a stream that ends', () => {
  it('does not forget the stream that replaced it', async () => {
    const pending = slowCameras()
    const first = useCaptureStore.getState().startCapture('a', 'dshow_video', CAMERA)
    await nextTick()
    const old = fakeStream()
    pending[0].resolve(old.stream)
    await first

    const second = useCaptureStore.getState().startCapture('a', 'dshow_video', CAMERA)
    await nextTick()
    const fresh = fakeStream()
    pending[1].resolve(fresh.stream)
    await second

    // The old stream's end arrives after the new one is in place.
    old.listeners.ended?.()

    expect(useCaptureStore.getState().getStream('a')).toBe(fresh.stream)
    expect(useCaptureStore.getState().activeIds).toEqual(['a'])
  })

  it('is forgotten when it is the current one', async () => {
    const pending = slowCameras()
    const started = useCaptureStore.getState().startCapture('a', 'dshow_video', CAMERA)
    await nextTick()
    const cam = fakeStream()
    pending[0].resolve(cam.stream)
    await started

    cam.listeners.ended()

    expect(useCaptureStore.getState().getStream('a')).toBeUndefined()
    expect(useCaptureStore.getState().activeIds).toEqual([])
  })
})
