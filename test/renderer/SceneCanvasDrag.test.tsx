// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, act } from '@testing-library/react'
import { installBridge, removeBridge, type BridgeStub } from '../mocks/bridge'

/**
 * Arranging sources is what makes the recording match the preview: the output
 * host draws each source where the canvas says it is. These drive the real
 * canvas with pointer and keyboard input and check where the source ends up,
 * what is saved, and what happens when a drag is abandoned.
 */

type Canvas = typeof import('../../src/components/studio/SceneCanvas')['SceneCanvas']
let SceneCanvas: Canvas
let useSourceStore: typeof import('../../src/stores/sourceStore')['useSourceStore']
let useUIStore: typeof import('../../src/stores/uiStore')['useUIStore']
let bridge: BridgeStub

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }

const SCENE = 'scene-1'
const place = (over: Record<string, unknown> = {}) => ({
  x: 100, y: 100, width: 400, height: 300, rotation: 0, scaleX: 1, scaleY: 1, ...over,
})

function seed(over: { locked?: boolean; transform?: Record<string, unknown> } = {}) {
  useSourceStore.setState({
    byScene: {
      [SCENE]: [{
        id: 'a', sceneId: SCENE, name: 'Screen', sourceType: 'display_capture', settings: {},
        orderIndex: 0, visible: true, locked: over.locked ?? false, muted: false, volume: 1,
        transform: place(over.transform) as never, createdAt: 0, updatedAt: 0,
      }],
    },
  })
}

const transformOf = () => useSourceStore.getState().byScene[SCENE][0].transform
const saves = () => bridge.calls.filter((c) => c.command === 'set_source_transform')
const layer = (c: HTMLElement) => c.querySelector('[data-source-id="a"]') as HTMLElement
const handle = (c: HTMLElement, h: string) => c.querySelector(`[data-handle="${h}"]`) as HTMLElement
const pointer = (type: string, x: number, y: number, shiftKey = false) =>
  act(() => { window.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, shiftKey })) })
const press = (el: Element, x: number, y: number) =>
  fireEvent.pointerDown(el, { clientX: x, clientY: y, button: 0 })

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  bridge = installBridge()
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  SceneCanvas = (await import('../../src/components/studio/SceneCanvas')).SceneCanvas
  useSourceStore = (await import('../../src/stores/sourceStore')).useSourceStore
  useUIStore = (await import('../../src/stores/uiStore')).useUIStore
  seed()
})
afterEach(() => { cleanup(); removeBridge(); vi.unstubAllGlobals() })

describe('moving', () => {
  it('follows the pointer', () => {
    const { container } = render(<SceneCanvas sceneId={SCENE} interactive />)
    press(layer(container), 50, 50)
    pointer('pointermove', 80, 70)

    expect(transformOf()).toMatchObject({ x: 130, y: 120, width: 400, height: 300 })
  })

  it('selects the source it is pressed on', () => {
    const { container } = render(<SceneCanvas sceneId={SCENE} interactive />)
    press(layer(container), 0, 0)
    expect(useUIStore.getState().selectedSourceId).toBe('a')
  })

  it('saves once, when the pointer is released, not for every move', () => {
    const { container } = render(<SceneCanvas sceneId={SCENE} interactive />)
    press(layer(container), 0, 0)
    for (let i = 1; i <= 20; i++) pointer('pointermove', i, i)
    expect(saves()).toHaveLength(0)

    pointer('pointerup', 20, 20)
    expect(saves()).toHaveLength(1)
    expect(JSON.parse(saves()[0].args.transform as string)).toMatchObject({ x: 120, y: 120 })
  })

  it('stops following once released', () => {
    const { container } = render(<SceneCanvas sceneId={SCENE} interactive />)
    press(layer(container), 0, 0)
    pointer('pointermove', 10, 10)
    pointer('pointerup', 10, 10)
    pointer('pointermove', 500, 500)

    expect(transformOf()).toMatchObject({ x: 110, y: 110 })
  })

  it('puts the source back, unsaved, when Escape is pressed', () => {
    const { container } = render(<SceneCanvas sceneId={SCENE} interactive />)
    press(layer(container), 0, 0)
    pointer('pointermove', 90, 90)
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    pointer('pointermove', 200, 200)
    pointer('pointerup', 200, 200)

    expect(transformOf()).toMatchObject({ x: 100, y: 100 })
    expect(saves()).toHaveLength(0)
  })

  it('puts the source back when the gesture is cancelled', () => {
    const { container } = render(<SceneCanvas sceneId={SCENE} interactive />)
    press(layer(container), 0, 0)
    pointer('pointermove', 90, 90)
    pointer('pointercancel', 90, 90)

    expect(transformOf()).toMatchObject({ x: 100, y: 100 })
    expect(saves()).toHaveLength(0)
  })

  it('ignores any button but the main one', () => {
    const { container } = render(<SceneCanvas sceneId={SCENE} interactive />)
    fireEvent.pointerDown(layer(container), { clientX: 0, clientY: 0, button: 2 })
    pointer('pointermove', 50, 50)
    expect(transformOf()).toMatchObject({ x: 100, y: 100 })
  })

  it('does nothing in a preview that is not interactive', () => {
    const { container } = render(<SceneCanvas sceneId={SCENE} />)
    press(layer(container), 0, 0)
    pointer('pointermove', 50, 50)
    expect(transformOf()).toMatchObject({ x: 100, y: 100 })
  })

  it('does not move a locked source', () => {
    seed({ locked: true })
    const { container } = render(<SceneCanvas sceneId={SCENE} interactive />)
    press(layer(container), 0, 0)
    pointer('pointermove', 50, 50)
    pointer('pointerup', 50, 50)

    expect(transformOf()).toMatchObject({ x: 100, y: 100 })
    expect(saves()).toHaveLength(0)
  })
})

describe('when the canvas is drawn smaller than it really is', () => {
  // The panel shows a 1920x1080 canvas at half size; a pointer movement of 50
  // screen pixels is 100 canvas pixels, or the source drifts from the pointer.
  it('turns screen movement into canvas movement', () => {
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({ width: 960, height: 540, x: 0, y: 0, top: 0, left: 0, right: 960, bottom: 540, toJSON: () => ({}) })
    const { container } = render(<SceneCanvas sceneId={SCENE} interactive />)
    press(layer(container), 0, 0)
    pointer('pointermove', 50, 25)
    rect.mockRestore()

    expect(transformOf()).toMatchObject({ x: 200, y: 150 })
  })
})

describe('resizing', () => {
  it('shows handles only for the selected source', () => {
    const { container } = render(<SceneCanvas sceneId={SCENE} interactive />)
    expect(container.querySelectorAll('[data-handle]')).toHaveLength(0)

    act(() => useUIStore.getState().selectSource('a'))
    expect(container.querySelectorAll('[data-handle]')).toHaveLength(8)
  })

  it('shows no handles on a locked source', () => {
    seed({ locked: true })
    act(() => useUIStore.getState().selectSource('a'))
    const { container } = render(<SceneCanvas sceneId={SCENE} interactive />)
    expect(container.querySelectorAll('[data-handle]')).toHaveLength(0)
  })

  it('pulls one edge and keeps the other where it was', () => {
    act(() => useUIStore.getState().selectSource('a'))
    const { container } = render(<SceneCanvas sceneId={SCENE} interactive />)
    press(handle(container, 'e'), 0, 0)
    pointer('pointermove', 60, 0)

    expect(transformOf()).toMatchObject({ x: 100, width: 460, height: 300 })
  })

  it('keeps the proportions from a corner', () => {
    act(() => useUIStore.getState().selectSource('a'))
    const { container } = render(<SceneCanvas sceneId={SCENE} interactive />)
    press(handle(container, 'se'), 0, 0)
    pointer('pointermove', 40, 0)

    const t = transformOf()
    expect(t.width / t.height).toBeCloseTo(400 / 300, 1)
    expect(t).toMatchObject({ x: 100, y: 100 })
  })

  it('lets a corner go free while Shift is held', () => {
    act(() => useUIStore.getState().selectSource('a'))
    const { container } = render(<SceneCanvas sceneId={SCENE} interactive />)
    press(handle(container, 'se'), 0, 0)
    pointer('pointermove', 40, 0, true)

    expect(transformOf()).toMatchObject({ width: 440, height: 300 })
  })

  it('does not move the source when a handle is pressed', () => {
    act(() => useUIStore.getState().selectSource('a'))
    const { container } = render(<SceneCanvas sceneId={SCENE} interactive />)
    press(handle(container, 'n'), 0, 0)
    pointer('pointermove', 30, 30)

    expect(transformOf().x).toBe(100)
  })

  it('cannot be dragged inside out', () => {
    act(() => useUIStore.getState().selectSource('a'))
    const { container } = render(<SceneCanvas sceneId={SCENE} interactive />)
    press(handle(container, 'e'), 0, 0)
    pointer('pointermove', -900, 0)

    expect(transformOf().width).toBeGreaterThan(0)
  })

  it('saves the new size once, on release', () => {
    act(() => useUIStore.getState().selectSource('a'))
    const { container } = render(<SceneCanvas sceneId={SCENE} interactive />)
    press(handle(container, 's'), 0, 0)
    pointer('pointermove', 0, 20)
    pointer('pointermove', 0, 40)
    pointer('pointerup', 0, 40)

    expect(saves()).toHaveLength(1)
    expect(JSON.parse(saves()[0].args.transform as string)).toMatchObject({ height: 340 })
  })
})

describe('arrow keys', () => {
  const key = (c: HTMLElement, k: string, shiftKey = false) =>
    fireEvent.keyDown(c.firstElementChild as HTMLElement, { key: k, shiftKey })

  it('nudge the selected source by one pixel, or ten with Shift', () => {
    act(() => useUIStore.getState().selectSource('a'))
    const { container } = render(<SceneCanvas sceneId={SCENE} interactive />)

    key(container, 'ArrowRight')
    expect(transformOf()).toMatchObject({ x: 101, y: 100 })
    key(container, 'ArrowDown', true)
    expect(transformOf()).toMatchObject({ x: 101, y: 110 })
  })

  it('save each nudge', () => {
    act(() => useUIStore.getState().selectSource('a'))
    const { container } = render(<SceneCanvas sceneId={SCENE} interactive />)
    key(container, 'ArrowLeft')
    expect(saves()).toHaveLength(1)
  })

  it('do nothing with nothing selected', () => {
    const { container } = render(<SceneCanvas sceneId={SCENE} interactive />)
    key(container, 'ArrowRight')
    expect(transformOf().x).toBe(100)
  })

  it('leave a locked source alone', () => {
    seed({ locked: true })
    act(() => useUIStore.getState().selectSource('a'))
    const { container } = render(<SceneCanvas sceneId={SCENE} interactive />)
    key(container, 'ArrowRight')
    expect(transformOf().x).toBe(100)
    expect(saves()).toHaveLength(0)
  })

  it('ignore other keys', () => {
    act(() => useUIStore.getState().selectSource('a'))
    const { container } = render(<SceneCanvas sceneId={SCENE} interactive />)
    key(container, 'a')
    expect(transformOf().x).toBe(100)
  })
})

describe('a drag whose source goes away', () => {
  it('leaves nothing behind when the canvas closes mid-drag', () => {
    const { container, unmount } = render(<SceneCanvas sceneId={SCENE} interactive />)
    press(layer(container), 0, 0)
    pointer('pointermove', 30, 30)
    unmount()
    pointer('pointermove', 300, 300)
    pointer('pointerup', 300, 300)

    expect(saves()).toHaveLength(0)
  })

  it('does not run two drags at once if pressed again', () => {
    const { container } = render(<SceneCanvas sceneId={SCENE} interactive />)
    press(layer(container), 0, 0)
    press(layer(container), 0, 0)
    pointer('pointerup', 0, 0)

    expect(saves()).toHaveLength(1)
  })
})

describe('clicking empty canvas', () => {
  it('clears the selection', () => {
    act(() => useUIStore.getState().selectSource('a'))
    const { container } = render(<SceneCanvas sceneId={SCENE} interactive />)
    fireEvent.pointerDown(container.firstElementChild as HTMLElement)
    expect(useUIStore.getState().selectedSourceId).toBeNull()
  })
})
