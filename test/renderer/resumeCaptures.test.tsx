// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { installBridge, removeBridge, type BridgeStub } from '../mocks/bridge'
import type { SourceDto } from '../../src/ipc'
import type { SourceItem } from '../../src/stores/sourceStore'

/**
 * Reopening the app used to leave every capture source dead until each was
 * restarted by hand. A source that remembers what it captures now starts again
 * on its own, once, and never in a loop.
 */

let bridge: BridgeStub
let useResumeCaptures: typeof import('../../src/hooks/useResumeCaptures')['useResumeCaptures']
let resetAttempts: typeof import('../../src/hooks/useResumeCaptures')['_resetResumeAttempts']
let sourcesToResume: typeof import('../../src/lib/capture/resume')['sourcesToResume']
let useSceneStore: typeof import('../../src/stores/sceneStore')['useSceneStore']
let useSourceStore: typeof import('../../src/stores/sourceStore')['useSourceStore']
let useCaptureStore: typeof import('../../src/stores/captureStore')['useCaptureStore']

const SCREEN = { kind: 'screen', id: 'screen:0:0', name: 'Entire screen' }
const withTarget = JSON.stringify({ capture: SCREEN })

function dto(id: string, sourceType = 'display_capture', settings = withTarget, sceneId = 's1'): SourceDto {
  return {
    id, sceneId, name: id, sourceType, settings, orderIndex: 0, visible: true, locked: false,
    muted: false, volume: 1, transform: '{}', createdAt: 0, updatedAt: 0,
  } as SourceDto
}

const stream = () => {
  const track = { stop: vi.fn(), addEventListener: vi.fn() }
  return { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream
}

let getDisplayMedia: ReturnType<typeof vi.fn>

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  bridge = installBridge()
  bridge.reply('list_capture_sources', [{ ...SCREEN, thumbnail: null, icon: null }])

  getDisplayMedia = vi.fn(async () => stream())
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getDisplayMedia, getUserMedia: vi.fn(async () => stream()), enumerateDevices: vi.fn(async () => []) },
    configurable: true,
  })

  const hook = await import('../../src/hooks/useResumeCaptures')
  useResumeCaptures = hook.useResumeCaptures
  resetAttempts = hook._resetResumeAttempts
  sourcesToResume = (await import('../../src/lib/capture/resume')).sourcesToResume
  useSceneStore = (await import('../../src/stores/sceneStore')).useSceneStore
  useSourceStore = (await import('../../src/stores/sourceStore')).useSourceStore
  useCaptureStore = (await import('../../src/stores/captureStore')).useCaptureStore

  resetAttempts()
  useSceneStore.setState({ activeSceneId: 's1' })
})

afterEach(() => removeBridge())

const settled = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })

describe('which sources resume', () => {
  const item = (id: string, type: string, settings: string): SourceItem => {
    useSourceStore.getState().seedSources('s1', [dto(id, type, settings)])
    return useSourceStore.getState().byScene.s1[0]
  }

  it('resumes a capture source that knows its target', () => {
    const src = item('a', 'display_capture', withTarget)
    expect(sourcesToResume([src], [], new Set())).toHaveLength(1)
  })

  it('skips one that was never told what to capture', () => {
    const src = item('a', 'display_capture', '{}')
    expect(sourcesToResume([src], [], new Set())).toEqual([])
  })

  it('skips sources that are not captures', () => {
    const src = item('a', 'image', withTarget)
    expect(sourcesToResume([src], [], new Set())).toEqual([])
  })

  it('skips one that is already live', () => {
    const src = item('a', 'display_capture', withTarget)
    expect(sourcesToResume([src], ['a'], new Set())).toEqual([])
  })

  it('skips one already tried', () => {
    const src = item('a', 'display_capture', withTarget)
    expect(sourcesToResume([src], [], new Set(['a']))).toEqual([])
  })

  it('copes with a scene that has no sources loaded', () => {
    expect(sourcesToResume(undefined, [], new Set())).toEqual([])
  })
})

describe('the hook', () => {
  it('starts a remembered capture once the scene loads', async () => {
    renderHook(() => useResumeCaptures())
    await act(async () => { useSourceStore.getState().seedSources('s1', [dto('a')]) })
    await settled()

    expect(useCaptureStore.getState().activeIds).toContain('a')
    expect(getDisplayMedia).toHaveBeenCalledTimes(1)
  })

  it('does not start it again when the list is reloaded', async () => {
    renderHook(() => useResumeCaptures())
    await act(async () => { useSourceStore.getState().seedSources('s1', [dto('a')]) })
    await settled()
    useCaptureStore.getState().stopCapture('a')

    await act(async () => { useSourceStore.getState().seedSources('s1', [dto('a')]) })
    await settled()

    expect(getDisplayMedia).toHaveBeenCalledTimes(1)
  })

  // A window that is not open must not be retried in a loop.
  it('tries a failing capture once and leaves the error showing', async () => {
    bridge.reply('list_capture_sources', [])
    renderHook(() => useResumeCaptures())

    await act(async () => { useSourceStore.getState().seedSources('s1', [dto('a')]) })
    await settled()
    await act(async () => { useSourceStore.getState().seedSources('s1', [dto('a')]) })
    await settled()

    expect(bridge.calls.filter((c) => c.command === 'list_capture_sources')).toHaveLength(1)
    expect(useCaptureStore.getState().errors.a).toContain('not available')
  })

  it('leaves another scene alone', async () => {
    renderHook(() => useResumeCaptures())
    await act(async () => { useSourceStore.getState().seedSources('s2', [dto('b', 'display_capture', withTarget, 's2')]) })
    await settled()

    expect(getDisplayMedia).not.toHaveBeenCalled()
  })

  it('starts several sources of one scene', async () => {
    renderHook(() => useResumeCaptures())
    await act(async () => { useSourceStore.getState().seedSources('s1', [dto('a'), dto('b')]) })
    await settled()

    expect([...useCaptureStore.getState().activeIds].sort()).toEqual(['a', 'b'])
  })

  it('does not start a source that is not set up', async () => {
    renderHook(() => useResumeCaptures())
    await act(async () => { useSourceStore.getState().seedSources('s1', [dto('a', 'display_capture', '{}')]) })
    await settled()

    expect(getDisplayMedia).not.toHaveBeenCalled()
    expect(useCaptureStore.getState().errors.a).toBeUndefined()
  })
})
