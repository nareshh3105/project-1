// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { installBridge, removeBridge, type BridgeStub } from '../mocks/bridge'
import type { SourceDto } from '../../src/ipc'

/**
 * When the backend refuses a change, the screen must stop claiming it
 * happened. These stores apply changes optimistically and then persist them;
 * the persist step used to sit in an empty catch, so a failed write left a
 * scene, a rename or a source on screen that was gone after the next launch.
 */

let bridge: BridgeStub
let useSceneStore: typeof import('../../src/stores/sceneStore')['useSceneStore']
let useSourceStore: typeof import('../../src/stores/sourceStore')['useSourceStore']
let useNotifyStore: typeof import('../../src/stores/notifyStore')['useNotifyStore']

const scene = (id: string, name: string, orderIndex: number) =>
  ({ id, collectionId: 'c1', name, orderIndex, createdAt: 0, updatedAt: 0 })

function dto(id: string, name: string, orderIndex = 0): SourceDto {
  return {
    id, sceneId: 's1', name, sourceType: 'display_capture', settings: '{}', orderIndex,
    visible: true, locked: false, muted: false, volume: 1, transform: '{}',
    createdAt: 0, updatedAt: 0,
  } as SourceDto
}

const messages = () => useNotifyStore.getState().notices.map((n) => n.message)
const sceneNames = () => useSceneStore.getState().scenes.map((s) => s.name)
const sources = () => useSourceStore.getState().byScene['s1'] ?? []

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  bridge = installBridge()
  Object.defineProperty(navigator, 'mediaDevices', { value: {}, configurable: true })

  useSceneStore = (await import('../../src/stores/sceneStore')).useSceneStore
  useSourceStore = (await import('../../src/stores/sourceStore')).useSourceStore
  useNotifyStore = (await import('../../src/stores/notifyStore')).useNotifyStore

  useSceneStore.setState({
    collectionId: 'c1',
    scenes: [scene('s1', 'Intro', 0), scene('s2', 'Main', 1), scene('s3', 'Outro', 2)],
    activeSceneId: 's1',
    previewSceneId: null,
  })
  useSourceStore.getState().seedSources('s1', [dto('a', 'Display', 0), dto('b', 'Webcam', 1)])
})

afterEach(() => removeBridge())

describe('a scene the backend refuses', () => {
  it('is not left on screen when creating fails', async () => {
    bridge.fail('create_scene', 'disk full')

    await useSceneStore.getState().createScene('Extra')

    expect(sceneNames()).toEqual(['Intro', 'Main', 'Outro'])
    expect(messages()).toEqual(["Couldn't add the scene: disk full"])
  })

  it('keeps its name when renaming fails', async () => {
    bridge.fail('rename_scene', 'database is locked')

    await useSceneStore.getState().renameScene('s2', 'Renamed')

    expect(sceneNames()).toEqual(['Intro', 'Main', 'Outro'])
    expect(messages()[0]).toContain("Couldn't rename the scene")
  })

  it('comes back, in place, when deleting fails', async () => {
    bridge.fail('delete_scene', 'database is locked')

    await useSceneStore.getState().deleteScene('s2')

    expect(sceneNames()).toEqual(['Intro', 'Main', 'Outro'])
    expect(messages()[0]).toContain("Couldn't delete the scene")
    // Its sources were released from memory when the delete began, so they have
    // to be fetched again or the restored scene would come back empty.
    expect(bridge.calls.some((c) => c.command === 'list_sources' && c.args.sceneId === 's2')).toBe(true)
  })

  it('is active again when it was the active scene whose deletion failed', async () => {
    bridge.fail('delete_scene', 'database is locked')

    await useSceneStore.getState().deleteScene('s1')

    expect(useSceneStore.getState().activeSceneId).toBe('s1')
  })

  it('does not leave a phantom copy when duplicating fails', async () => {
    bridge.fail('duplicate_scene', 'disk full')

    await useSceneStore.getState().duplicateScene('s1')

    expect(sceneNames()).toEqual(['Intro', 'Main', 'Outro'])
    expect(messages()[0]).toContain("Couldn't duplicate the scene")
  })

  it('keeps the old order when reordering fails', async () => {
    bridge.fail('reorder_scenes', 'database is locked')

    await useSceneStore.getState().reorderScenes(['s3', 's2', 's1'])

    expect(sceneNames()).toEqual(['Intro', 'Main', 'Outro'])
    expect(messages()[0]).toContain("Couldn't reorder the scenes")
  })
})

describe('a source the backend refuses', () => {
  it('is not left on screen when adding fails', async () => {
    bridge.fail('add_source', 'disk full')

    await useSourceStore.getState().addSource('s1', 'Extra', 'display_capture')

    expect(sources().map((s) => s.name)).toEqual(['Display', 'Webcam'])
    expect(messages()).toEqual(["Couldn't add the source: disk full"])
  })

  it('comes back, in place, when removing fails', async () => {
    bridge.fail('remove_source', 'database is locked')

    await useSourceStore.getState().removeSource('s1', 'a')

    expect(sources().map((s) => s.name)).toEqual(['Display', 'Webcam'])
    expect(messages()[0]).toContain("Couldn't remove the source")
  })

  it('keeps its name when renaming fails', async () => {
    bridge.fail('rename_source', 'database is locked')

    await useSourceStore.getState().renameSource('s1', 'a', 'Renamed')

    expect(sources()[0].name).toBe('Display')
    expect(messages()[0]).toContain("Couldn't rename the source")
  })

  it('keeps its visibility when toggling fails', async () => {
    bridge.fail('set_source_visible', 'database is locked')

    await useSourceStore.getState().setVisible('s1', 'a', false)

    expect(sources()[0].visible).toBe(true)
    expect(messages()[0]).toContain("Couldn't hide the source")
  })

  it('keeps its lock when toggling fails', async () => {
    bridge.fail('set_source_locked', 'database is locked')

    await useSourceStore.getState().setLocked('s1', 'a', true)

    expect(sources()[0].locked).toBe(false)
    expect(messages()[0]).toContain("Couldn't lock the source")
  })

  it('keeps the old order when reordering fails', async () => {
    bridge.fail('reorder_sources', 'database is locked')

    await useSourceStore.getState().reorderSources('s1', ['b', 'a'])

    expect(sources().map((s) => s.id)).toEqual(['a', 'b'])
    expect(messages()[0]).toContain("Couldn't reorder the sources")
  })

  // Rolling back mid-drag would snatch the source from under the pointer; the
  // placement stays, and the user is told it was not saved.
  it('reports an unsaved position but leaves the source where it was dragged', async () => {
    bridge.fail('set_source_transform', 'database is locked')
    useSourceStore.getState().setTransform('s1', 'a', { x: 300 })

    await useSourceStore.getState().commitTransform('s1', 'a')

    expect(sources()[0].transform.x).toBe(300)
    expect(messages()[0]).toContain("Couldn't save the source position")
  })
})

describe('when the backend succeeds', () => {
  it('stays quiet', async () => {
    await useSceneStore.getState().renameScene('s2', 'Renamed')
    await useSourceStore.getState().renameSource('s1', 'a', 'Renamed')
    await useSourceStore.getState().setVisible('s1', 'a', false)

    expect(messages()).toEqual([])
    expect(sceneNames()[1]).toBe('Renamed')
    expect(sources()[0].visible).toBe(false)
  })
})

describe('a project that will not open', () => {
  it('says changes will not be saved', async () => {
    bridge.fail('init_default_collection', 'unable to open database file')

    await useSceneStore.getState().initApp()

    expect(messages().some((m) => /won't be saved/.test(m))).toBe(true)
    expect(messages().some((m) => /unable to open database file/.test(m))).toBe(true)
    // The window stays usable on an in-memory scene rather than going blank.
    expect(useSceneStore.getState().scenes).toHaveLength(1)
  })
})

describe('notices', () => {
  it('does not stack the same failure twice', async () => {
    bridge.fail('rename_scene', 'database is locked')

    await useSceneStore.getState().renameScene('s2', 'A')
    await useSceneStore.getState().renameScene('s2', 'B')

    expect(messages()).toHaveLength(1)
  })

  it('keeps only the most recent few', () => {
    const { notify } = useNotifyStore.getState()
    for (let i = 0; i < 9; i++) notify('error', `failure ${i}`)

    expect(messages()).toHaveLength(4)
    expect(messages().at(-1)).toBe('failure 8')
  })
})
