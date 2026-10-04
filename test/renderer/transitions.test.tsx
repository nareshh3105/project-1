// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installBridge, removeBridge, type BridgeStub } from '../mocks/bridge'

/**
 * A scene change in studio mode: the new scene is on air at once, the old one
 * stays under it while the change plays, and the output window is told when it
 * began so it can play the same change in the recording.
 */

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }

let useTransitionStore: typeof import('../../src/stores/transitionStore')['useTransitionStore']
let useSceneStore: typeof import('../../src/stores/sceneStore')['useSceneStore']
let useSourceStore: typeof import('../../src/stores/sourceStore')['useSourceStore']
let TransitionBar: typeof import('../../src/components/studio/TransitionBar')['TransitionBar']
let PreviewPanel: typeof import('../../src/components/panels/PreviewPanel')['PreviewPanel']
let useUIStore: typeof import('../../src/stores/uiStore')['useUIStore']
let useHostState: typeof import('../../src/hooks/useHostState')['useHostState']
let bridge: BridgeStub

const scene = (id: string) => ({ id, collectionId: 'c', name: id, orderIndex: 0, createdAt: 0, updatedAt: 0 })
const source = (id: string, sceneId: string) => ({
  id, sceneId, name: id, sourceType: 'color_source', settings: { color: '#ff0000' }, orderIndex: 0, visible: true,
  locked: false, muted: false, volume: 1, transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, scaleX: 1, scaleY: 1 },
  createdAt: 0, updatedAt: 0,
})

function seedScenes() {
  useSceneStore.setState({ scenes: [scene('A'), scene('B')] as never, activeSceneId: 'A', previewSceneId: 'B' })
  useSourceStore.setState({ byScene: { A: [source('sa', 'A')], B: [source('sb', 'B')] } as never })
}

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  bridge = installBridge()
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  useTransitionStore = (await import('../../src/stores/transitionStore')).useTransitionStore
  useSceneStore = (await import('../../src/stores/sceneStore')).useSceneStore
  useSourceStore = (await import('../../src/stores/sourceStore')).useSourceStore
  TransitionBar = (await import('../../src/components/studio/TransitionBar')).TransitionBar
  PreviewPanel = (await import('../../src/components/panels/PreviewPanel')).PreviewPanel
  useUIStore = (await import('../../src/stores/uiStore')).useUIStore
  useHostState = (await import('../../src/hooks/useHostState')).useHostState
})
afterEach(() => { cleanup(); removeBridge(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('the store', () => {
  it('changes scene at once for a cut, and plays nothing', () => {
    useTransitionStore.getState().setType('cut')
    const swap = vi.fn()
    useTransitionStore.getState().executeTransition({ fromSceneId: 'A', toSceneId: 'B' }, swap)

    expect(swap).toHaveBeenCalledTimes(1)
    expect(useTransitionStore.getState().active).toBeNull()
    expect(useTransitionStore.getState().isTransitioning).toBe(false)
  })

  it('changes scene at once for anything else too, and records what is playing', () => {
    vi.useFakeTimers()
    vi.setSystemTime(5000)
    useTransitionStore.getState().setType('slide')
    useTransitionStore.getState().setDuration(800)
    const swap = vi.fn()
    useTransitionStore.getState().executeTransition({ fromSceneId: 'A', toSceneId: 'B' }, swap)

    expect(swap).toHaveBeenCalledTimes(1)
    expect(useTransitionStore.getState().active).toEqual({
      fromSceneId: 'A', toSceneId: 'B', type: 'slide', durationMs: 800, startedAt: 5000,
    })
    expect(useTransitionStore.getState().isTransitioning).toBe(true)
  })

  it('finishes after its duration', () => {
    vi.useFakeTimers()
    useTransitionStore.getState().setType('fade')
    useTransitionStore.getState().setDuration(300)
    useTransitionStore.getState().executeTransition({ fromSceneId: 'A', toSceneId: 'B' }, () => {})

    vi.advanceTimersByTime(299)
    expect(useTransitionStore.getState().isTransitioning).toBe(true)
    vi.advanceTimersByTime(2)
    expect(useTransitionStore.getState().isTransitioning).toBe(false)
    expect(useTransitionStore.getState().active).toBeNull()
  })

  it('does not let a finished timer end a different transition', () => {
    vi.useFakeTimers()
    useTransitionStore.getState().setType('fade')
    useTransitionStore.getState().setDuration(300)
    useTransitionStore.getState().executeTransition({ fromSceneId: 'A', toSceneId: 'B' }, () => {})
    // A newer transition has taken its place by the time the first timer fires.
    useTransitionStore.setState({ active: { ...useTransitionStore.getState().active!, startedAt: 1 } })

    vi.advanceTimersByTime(500)
    expect(useTransitionStore.getState().active?.startedAt).toBe(1)
  })

  it('ignores a second request while one is playing', () => {
    vi.useFakeTimers()
    useTransitionStore.getState().setType('fade')
    const second = vi.fn()
    useTransitionStore.getState().executeTransition({ fromSceneId: 'A', toSceneId: 'B' }, () => {})
    useTransitionStore.getState().executeTransition({ fromSceneId: 'B', toSceneId: 'A' }, second)

    expect(second).not.toHaveBeenCalled()
    expect(useTransitionStore.getState().active?.toSceneId).toBe('B')
  })

  it('can play another after the first has finished', () => {
    vi.useFakeTimers()
    useTransitionStore.getState().setType('fade')
    useTransitionStore.getState().executeTransition({ fromSceneId: 'A', toSceneId: 'B' }, () => {})
    vi.advanceTimersByTime(5000)

    const next = vi.fn()
    useTransitionStore.getState().executeTransition({ fromSceneId: 'B', toSceneId: 'A' }, next)
    expect(next).toHaveBeenCalled()
    expect(useTransitionStore.getState().active?.toSceneId).toBe('A')
  })
})

describe('staging a scene', () => {
  it('loads its sources, so the preview and the incoming transition have something to show', async () => {
    seedScenes()
    useSourceStore.setState({ byScene: {} })
    bridge.reply('list_sources', [])
    act(() => useSceneStore.getState().setPreviewScene('B'))
    await act(async () => { await new Promise((r) => setTimeout(r, 10)) })

    expect(bridge.calls.filter((c) => c.command === 'list_sources').map((c) => c.args.sceneId)).toContain('B')
  })
})

describe('the Transition button', () => {
  it('puts the staged scene on air and stages the old one', async () => {
    seedScenes()
    render(<TransitionBar />)
    await userEvent.click(screen.getByRole('button', { name: 'Transition' }))

    expect(useSceneStore.getState().activeSceneId).toBe('B')
    expect(useTransitionStore.getState().active).toMatchObject({ fromSceneId: 'A', toSceneId: 'B' })
  })

  it('does nothing when the staged scene is already on air', async () => {
    seedScenes()
    useSceneStore.setState({ previewSceneId: 'A' })
    render(<TransitionBar />)
    expect(screen.getByRole('button', { name: 'Transition' })).toBeDisabled()
  })
})

describe('the program view', () => {
  const programLayers = (container: HTMLElement) => container.querySelectorAll('[data-source-id]')

  async function onAirWith(type: 'fade' | 'slide' | 'wipe') {
    seedScenes()
    useUIStore.setState({ studioMode: true })
    useTransitionStore.getState().setType(type)
    const view = render(<PreviewPanel />)
    await act(async () => {
      useTransitionStore.getState().executeTransition(
        { fromSceneId: 'A', toSceneId: 'B' },
        () => useSceneStore.setState({ activeSceneId: 'B', previewSceneId: 'A' }),
      )
    })
    return view
  }

  it('shows both scenes while a transition plays', async () => {
    const { container } = await onAirWith('fade')
    const program = container.querySelector('.border-state-danger\\/25')!.parentElement!
    const ids = [...program.querySelectorAll('[data-source-id]')].map((e) => e.getAttribute('data-source-id'))
    expect(ids.sort()).toEqual(['sa', 'sb'])
  })

  it('fades the old scene out over the new', async () => {
    const { container } = await onAirWith('fade')
    const program = container.querySelector('.border-state-danger\\/25')!.parentElement!
    const animated = [...program.querySelectorAll<HTMLElement>('div[style*="animation"]')]
    expect(animated).toHaveLength(1)
    expect(animated[0].style.animationName).toBe('xfade-out')
    expect(animated[0].querySelector('[data-source-id="sa"]')).not.toBeNull() // the old scene
  })

  it('slides the old scene out and the new one in', async () => {
    const { container } = await onAirWith('slide')
    const program = container.querySelector('.border-state-danger\\/25')!.parentElement!
    const byName = (name: string) =>
      [...program.querySelectorAll<HTMLElement>('div[style*="animation"]')].find((e) => e.style.animationName === name)!
    expect(byName('xslide-out').querySelector('[data-source-id="sa"]')).not.toBeNull() // the old scene leaves
    expect(byName('xslide-in').querySelector('[data-source-id="sb"]')).not.toBeNull() // the new one enters
  })

  it('uncovers the new scene for a wipe, with the old one still showing underneath', async () => {
    const { container } = await onAirWith('wipe')
    const program = container.querySelector('.border-state-danger\\/25')!.parentElement!
    const underneath = ([...program.children] as HTMLElement[]).find((e) => !e.style.animationName && e.querySelector('[data-source-id]'))!
    expect(underneath.querySelector('[data-source-id="sa"]')).not.toBeNull()
    const animated = [...program.querySelectorAll<HTMLElement>('div[style*="animation"]')]
    expect(animated.map((e) => e.style.animationName)).toEqual(['xwipe-in'])
    expect(animated[0].querySelector('[data-source-id="sb"]')).not.toBeNull() // the new scene
  })

  it('uses the same easing as the recording', async () => {
    const { container } = await onAirWith('fade')
    const el = container.querySelector<HTMLElement>('div[style*="animation"]')!
    expect(el.style.animationTimingFunction).toBe('ease-in-out')
  })

  it('shows just the one scene once it is over', async () => {
    vi.useFakeTimers()
    const { container } = await onAirWith('fade')
    await act(async () => { vi.advanceTimersByTime(5000) })
    const program = container.querySelector('.border-state-danger\\/25')!.parentElement!
    expect([...program.querySelectorAll('[data-source-id]')].map((e) => e.getAttribute('data-source-id'))).toEqual(['sb'])
  })

  it('shows just the one scene for a cut', async () => {
    seedScenes()
    useUIStore.setState({ studioMode: true })
    useTransitionStore.getState().setType('cut')
    const { container } = render(<PreviewPanel />)
    await act(async () => {
      useTransitionStore.getState().executeTransition({ fromSceneId: 'A', toSceneId: 'B' },
        () => useSceneStore.setState({ activeSceneId: 'B', previewSceneId: 'A' }))
    })
    const program = container.querySelector('.border-state-danger\\/25')!.parentElement!
    expect(program.querySelectorAll('[data-source-id]')).toHaveLength(1)
  })
})

describe('telling the output window', () => {
  function Hook() { useHostState(); return null }
  const published = () => bridge.calls.filter((c) => c.command === 'host_push_state').map((c) => c.args.snapshot as {
    sources: Array<{ id: string }>; transition?: { type: string; durationMs: number; startedAt: number; from: Array<{ id: string }> }
  })
  const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 120)) })

  it('sends the transition with the outgoing scene while it plays', async () => {
    seedScenes()
    useTransitionStore.getState().setType('wipe')
    useTransitionStore.getState().setDuration(2000)
    render(<Hook />)
    await settle()

    act(() => {
      useTransitionStore.getState().executeTransition({ fromSceneId: 'A', toSceneId: 'B' },
        () => useSceneStore.setState({ activeSceneId: 'B' }))
    })
    await settle()

    const last = published().at(-1)!
    expect(last.sources.map((s) => s.id)).toEqual(['sb'])
    expect(last.transition).toMatchObject({ type: 'wipe', durationMs: 2000 })
    expect(last.transition!.from.map((s) => s.id)).toEqual(['sa'])
    expect(typeof last.transition!.startedAt).toBe('number')
  })

  it('stops sending it when it is over', async () => {
    seedScenes()
    useTransitionStore.getState().setType('fade')
    useTransitionStore.getState().setDuration(100)
    render(<Hook />)
    act(() => {
      useTransitionStore.getState().executeTransition({ fromSceneId: 'A', toSceneId: 'B' },
        () => useSceneStore.setState({ activeSceneId: 'B' }))
    })
    await act(async () => { await new Promise((r) => setTimeout(r, 400)) })

    expect(published().at(-1)!.transition).toBeUndefined()
  })

  it('does not send one for a scene that has since been replaced', async () => {
    seedScenes()
    useTransitionStore.getState().setType('fade')
    useTransitionStore.getState().setDuration(5000)
    render(<Hook />)
    act(() => {
      useTransitionStore.getState().executeTransition({ fromSceneId: 'A', toSceneId: 'B' },
        () => useSceneStore.setState({ activeSceneId: 'B' }))
    })
    await settle()
    act(() => useSceneStore.setState({ activeSceneId: 'A' })) // a scene clicked meanwhile
    await settle()

    expect(published().at(-1)!.transition).toBeUndefined()
  })

  it('sends none for a cut', async () => {
    seedScenes()
    useTransitionStore.getState().setType('cut')
    render(<Hook />)
    act(() => {
      useTransitionStore.getState().executeTransition({ fromSceneId: 'A', toSceneId: 'B' },
        () => useSceneStore.setState({ activeSceneId: 'B' }))
    })
    await settle()
    expect(published().every((s) => s.transition === undefined)).toBe(true)
  })
})
