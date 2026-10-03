// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { installBridge, removeBridge, type BridgeStub } from '../mocks/bridge'
import type { SourceDto } from '../../src/ipc'

/**
 * A screen or camera capture is a live MediaStream held outside the stores.
 * Nothing stops it unless something asks, and once its source is gone there is
 * no control left on screen to ask with — the OS keeps showing "sharing your
 * screen" for a capture the user can no longer see or end.
 */

let bridge: BridgeStub
let useSceneStore: typeof import('../../src/stores/sceneStore')['useSceneStore']
let nextSceneName: typeof import('../../src/stores/sceneStore')['nextSceneName']
let useSourceStore: typeof import('../../src/stores/sourceStore')['useSourceStore']
let useCaptureStore: typeof import('../../src/stores/captureStore')['useCaptureStore']

/** A stream whose tracks record whether they were stopped. */
function fakeStream() {
  const track = { stop: vi.fn(), addEventListener: vi.fn() }
  return {
    track,
    stream: { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream,
  }
}

function dto(id: string, sceneId: string, type = 'display_capture'): SourceDto {
  return {
    id, sceneId, name: id, sourceType: type, settings: '{}', orderIndex: 0,
    visible: true, locked: false, muted: false, volume: 1,
    transform: '{}', createdAt: 0, updatedAt: 0,
  } as SourceDto
}

const SCREEN = { kind: 'screen' as const, id: 'screen:0:0', name: 'Entire screen' }

/** Starts a capture for `sourceId` and returns its track, to assert on. */
async function capture(sourceId: string) {
  const { track, stream } = fakeStream()
  // What the main process reports, then what the browser hands back.
  bridge.reply('list_capture_sources', [{ ...SCREEN, thumbnail: null, icon: null }])
  ;(navigator.mediaDevices as unknown as { getDisplayMedia: unknown }).getDisplayMedia =
    vi.fn(async () => stream)
  await useCaptureStore.getState().startCapture(sourceId, 'display_capture', SCREEN)
  expect(useCaptureStore.getState().activeIds).toContain(sourceId)
  return track
}

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  bridge = installBridge()

  Object.defineProperty(navigator, 'mediaDevices', { value: {}, configurable: true })

  const scenes = await import('../../src/stores/sceneStore')
  useSceneStore = scenes.useSceneStore
  nextSceneName = scenes.nextSceneName
  useSourceStore = (await import('../../src/stores/sourceStore')).useSourceStore
  useCaptureStore = (await import('../../src/stores/captureStore')).useCaptureStore

  useSceneStore.setState({
    collectionId: 'c1',
    scenes: [
      { id: 's1', collectionId: 'c1', name: 'Scene 1', orderIndex: 0, createdAt: 0, updatedAt: 0 },
      { id: 's2', collectionId: 'c1', name: 'Scene 2', orderIndex: 1, createdAt: 0, updatedAt: 0 },
    ],
    activeSceneId: 's1',
    previewSceneId: null,
  })
  useSourceStore.getState().seedSources('s1', [dto('a', 's1')])
  useSourceStore.getState().seedSources('s2', [dto('b', 's2')])
})

afterEach(() => removeBridge())

describe('removing a source', () => {
  it('stops its capture', async () => {
    const track = await capture('a')

    await useSourceStore.getState().removeSource('s1', 'a')

    expect(track.stop).toHaveBeenCalled()
    expect(useCaptureStore.getState().activeIds).not.toContain('a')
  })

  it('leaves other sources capturing', async () => {
    await capture('a')
    const other = await capture('b')

    await useSourceStore.getState().removeSource('s1', 'a')

    expect(other.stop).not.toHaveBeenCalled()
    expect(useCaptureStore.getState().activeIds).toContain('b')
  })
})

describe('deleting a scene', () => {
  it('stops the captures of every source in it', async () => {
    const track = await capture('b')

    await useSceneStore.getState().deleteScene('s2')

    expect(track.stop).toHaveBeenCalled()
    expect(useCaptureStore.getState().activeIds).not.toContain('b')
  })

  it('drops its sources from memory', async () => {
    await useSceneStore.getState().deleteScene('s2')
    expect(useSourceStore.getState().byScene['s2']).toBeUndefined()
  })

  it('leaves other scenes capturing', async () => {
    const keep = await capture('a')

    await useSceneStore.getState().deleteScene('s2')

    expect(keep.stop).not.toHaveBeenCalled()
  })

  // A scene staged in Studio Mode and then deleted stayed referenced and
  // rendered as an empty preview.
  it('clears a preview that pointed at it', async () => {
    useSceneStore.setState({ previewSceneId: 's2' })

    await useSceneStore.getState().deleteScene('s2')

    expect(useSceneStore.getState().previewSceneId).toBeNull()
  })

  it('keeps a preview that pointed elsewhere', async () => {
    useSceneStore.setState({ previewSceneId: 's1' })
    await useSceneStore.getState().deleteScene('s2')
    expect(useSceneStore.getState().previewSceneId).toBe('s1')
  })

  // Assigning the id directly skipped the lazy source load, so the replacement
  // scene showed nothing until it was clicked again.
  it('loads the sources of the scene that replaces the active one', async () => {
    bridge.reply('list_sources', [dto('b', 's2')])

    await useSceneStore.getState().deleteScene('s1')

    expect(useSceneStore.getState().activeSceneId).toBe('s2')
    // The load starts just after the delete resolves.
    await vi.waitFor(() =>
      expect(bridge.calls.some((c) => c.command === 'list_sources' && c.args.sceneId === 's2')).toBe(true),
    )
  })

  it('leaves the active scene alone when another is deleted', async () => {
    await useSceneStore.getState().deleteScene('s2')
    expect(useSceneStore.getState().activeSceneId).toBe('s1')
  })

  it('ends with no active scene when the last one goes', async () => {
    await useSceneStore.getState().deleteScene('s1')
    await useSceneStore.getState().deleteScene('s2')
    expect(useSceneStore.getState().activeSceneId).toBeNull()
  })
})

describe('switching collection', () => {
  it('stops captures belonging to the collection being left', async () => {
    const track = await capture('a')

    useSceneStore.getState().loadCollection('c2', [
      { id: 'x1', collectionId: 'c2', name: 'Scene 1', orderIndex: 0, createdAt: 0, updatedAt: 0 },
    ])

    expect(track.stop).toHaveBeenCalled()
    expect(useCaptureStore.getState().activeIds).toEqual([])
  })
})

describe('naming a new scene', () => {
  it('starts at Scene 1', () => {
    expect(nextSceneName([])).toBe('Scene 1')
  })

  it('continues the sequence', () => {
    expect(nextSceneName(['Scene 1', 'Scene 2'])).toBe('Scene 3')
  })

  // The old rule was `Scene ${count + 1}`: with Scene 1 and Scene 3 left the
  // count is two, so the next scene came out as a second "Scene 3".
  it('does not repeat a name after a deletion', () => {
    expect(nextSceneName(['Scene 1', 'Scene 3'])).toBe('Scene 2')
  })

  it('ignores names that merely look similar', () => {
    expect(nextSceneName(['Intro', 'Scene 1 (copy)'])).toBe('Scene 1')
  })
})
