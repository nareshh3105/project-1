// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { installBridge, removeBridge } from '../mocks/bridge'

/**
 * The preview must show a source the way the recording will: the same filter
 * string on the picture, and the SVG filters it refers to present in the page.
 */

let SceneCanvas: typeof import('../../src/components/studio/SceneCanvas')['SceneCanvas']
let useSourceStore: typeof import('../../src/stores/sourceStore')['useSourceStore']
let useFilterStore: typeof import('../../src/stores/filterStore')['useFilterStore']

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
const SCENE = 's1'

const seed = (id = 'a', sourceType = 'color_source') =>
  useSourceStore.setState({
    byScene: {
      [SCENE]: [{
        id, sceneId: SCENE, name: id, sourceType, settings: { color: '#00ff00' }, orderIndex: 0, visible: true, locked: false,
        muted: false, volume: 1, transform: { x: 0, y: 0, width: 400, height: 200, rotation: 0, scaleX: 1, scaleY: 1 },
        createdAt: 0, updatedAt: 0,
      }],
    } as never,
  })

const filterOf = (container: HTMLElement) =>
  (container.querySelector('[data-source-id="a"] canvas') as HTMLElement).style.getPropertyValue('filter')

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  installBridge()
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  SceneCanvas = (await import('../../src/components/studio/SceneCanvas')).SceneCanvas
  useSourceStore = (await import('../../src/stores/sourceStore')).useSourceStore
  useFilterStore = (await import('../../src/stores/filterStore')).useFilterStore
})
afterEach(() => { cleanup(); removeBridge(); vi.unstubAllGlobals() })

describe('filters in the preview', () => {
  it('shows a source without any when it has none', () => {
    seed()
    const { container } = render(<SceneCanvas sceneId={SCENE} />)
    expect(filterOf(container)).toBe('')
  })

  it('puts the filter on the picture', () => {
    seed()
    act(() => useFilterStore.getState().addFilter('a', 'blur'))
    const { container } = render(<SceneCanvas sceneId={SCENE} />)
    expect(filterOf(container)).toBe('blur(5px)')
  })

  it('follows a change to the filter', () => {
    seed()
    act(() => useFilterStore.getState().addFilter('a', 'blur'))
    const { container } = render(<SceneCanvas sceneId={SCENE} />)

    const id = useFilterStore.getState().filtersBySource.a[0].id
    act(() => useFilterStore.getState().updateFilter('a', id, { radius: 12 } as never))
    expect(filterOf(container)).toBe('blur(12px)')
  })

  it('stops applying a filter that is switched off', () => {
    seed()
    act(() => useFilterStore.getState().addFilter('a', 'blur'))
    const { container } = render(<SceneCanvas sceneId={SCENE} />)

    const id = useFilterStore.getState().filtersBySource.a[0].id
    act(() => useFilterStore.getState().toggleFilter('a', id))
    expect(filterOf(container)).toBe('')
  })

  it('leaves other sources alone', () => {
    seed()
    act(() => useFilterStore.getState().addFilter('someone-else', 'blur'))
    const { container } = render(<SceneCanvas sceneId={SCENE} />)
    expect(filterOf(container)).toBe('')
  })
})

describe('the SVG filters the preview refers to', () => {
  const holders = () => [...document.querySelectorAll('svg[id^="cb-defs-"]')]

  it('are put in the page for a chroma key', () => {
    seed()
    act(() => useFilterStore.getState().addFilter('a', 'chroma-key'))
    render(<SceneCanvas sceneId={SCENE} />)
    expect(holders().map((h) => h.innerHTML).join('')).toContain('feColorMatrix')
  })

  it('are not needed for plain adjustments', () => {
    seed()
    act(() => useFilterStore.getState().addFilter('a', 'blur'))
    render(<SceneCanvas sceneId={SCENE} />)
    expect(holders().map((h) => h.innerHTML.replace('<defs></defs>', '')).join('')).toBe('')
  })

  it('are removed when the canvas closes', () => {
    seed()
    act(() => useFilterStore.getState().addFilter('a', 'sharpen'))
    const view = render(<SceneCanvas sceneId={SCENE} />)
    expect(holders().length).toBeGreaterThan(0)
    view.unmount()
    expect(holders()).toHaveLength(0)
  })

  it('belong to each canvas separately, so closing one keeps the other\'s', () => {
    seed()
    act(() => useFilterStore.getState().addFilter('a', 'sharpen'))
    const first = render(<SceneCanvas sceneId={SCENE} />)
    render(<SceneCanvas sceneId={SCENE} />)
    expect(holders()).toHaveLength(2)
    first.unmount()
    expect(holders()).toHaveLength(1)
  })
})
