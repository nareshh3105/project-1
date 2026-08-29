import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Exercises the command handlers against a real database rather than a mocked
 * one, so schema constraints and cascade behaviour are part of what is tested.
 */

let dbFile: string
let mod: {
  invoke: (name: string, args?: Record<string, unknown>) => Promise<unknown>
  closeDatabase: () => void
}

interface SceneDto { id: string; name: string; orderIndex: number; collectionId: string }
interface SourceDto { id: string; name: string; visible: boolean; orderIndex: number }
interface CollectionDto { id: string; name: string }

beforeEach(async () => {
  vi.resetModules()

  dbFile = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'cb-cmd-')),
    'codebuilders.db',
  )

  const db = await import('../../electron/main/db')
  const ipc = await import('../../electron/main/ipc')
  const scenes = await import('../../electron/main/commands/scenes')
  const sources = await import('../../electron/main/commands/sources')
  const collections = await import('../../electron/main/commands/collections')

  db.initDatabase(dbFile)
  scenes.registerSceneCommands()
  sources.registerSourceCommands()
  collections.registerCollectionCommands()

  ipc.installDispatcher()
  const { ipcMain } = await import('electron')
  const handler = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1]

  mod = {
    invoke: (name, args = {}) => handler({}, name, args),
    closeDatabase: db.closeDatabase,
  }
})

afterEach(() => {
  mod.closeDatabase()
  fs.rmSync(path.dirname(dbFile), { recursive: true, force: true })
})

const initDefault = () =>
  mod.invoke('init_default_collection') as Promise<{
    collectionId: string
    scenes: SceneDto[]
  }>

describe('init_default_collection', () => {
  it('seeds a collection and one scene on an empty database', async () => {
    const result = await initDefault()
    expect(result.collectionId).toBeTruthy()
    expect(result.scenes).toHaveLength(1)
    expect(result.scenes[0].name).toBe('Scene 1')
  })

  it('is idempotent — a second call does not seed again', async () => {
    const first = await initDefault()
    const second = await initDefault()
    expect(second.collectionId).toBe(first.collectionId)
    expect(second.scenes).toHaveLength(1)
  })

  it('returns camelCase keys, matching what the interface expects', async () => {
    const { scenes } = await initDefault()
    expect(scenes[0]).toHaveProperty('orderIndex')
    expect(scenes[0]).toHaveProperty('collectionId')
    expect(scenes[0]).not.toHaveProperty('order_index')
  })
})

describe('scene commands', () => {
  let collectionId: string

  beforeEach(async () => {
    collectionId = (await initDefault()).collectionId
  })

  it('appends a created scene after the existing ones', async () => {
    const scene = (await mod.invoke('create_scene', {
      collectionId, name: 'Scene 2',
    })) as SceneDto
    expect(scene.orderIndex).toBe(1)
  })

  it('renames a scene', async () => {
    const { scenes } = await initDefault()
    await mod.invoke('rename_scene', { id: scenes[0].id, name: 'Intro' })

    const list = (await mod.invoke('list_scenes', { collectionId })) as SceneDto[]
    expect(list[0].name).toBe('Intro')
  })

  it('deletes a scene', async () => {
    await mod.invoke('create_scene', { collectionId, name: 'Scene 2' })
    const before = (await mod.invoke('list_scenes', { collectionId })) as SceneDto[]

    await mod.invoke('delete_scene', { id: before[1].id })

    const after = (await mod.invoke('list_scenes', { collectionId })) as SceneDto[]
    expect(after).toHaveLength(1)
  })

  it('removes a deleted scene’s sources', async () => {
    const { scenes } = await initDefault()
    await mod.invoke('add_source', {
      sceneId: scenes[0].id, name: 'Display', sourceType: 'display', settings: '{}',
    })

    await mod.invoke('delete_scene', { id: scenes[0].id })

    const orphans = (await mod.invoke('list_sources', {
      sceneId: scenes[0].id,
    })) as SourceDto[]
    expect(orphans).toEqual([])
  })

  it('reorders scenes to match the given sequence', async () => {
    await mod.invoke('create_scene', { collectionId, name: 'B' })
    await mod.invoke('create_scene', { collectionId, name: 'C' })
    const list = (await mod.invoke('list_scenes', { collectionId })) as SceneDto[]

    await mod.invoke('reorder_scenes', {
      ids: [list[2].id, list[0].id, list[1].id],
    })

    const reordered = (await mod.invoke('list_scenes', { collectionId })) as SceneDto[]
    expect(reordered.map((s) => s.name)).toEqual(['C', 'Scene 1', 'B'])
  })

  it('copies a scene’s sources when duplicating it', async () => {
    const { scenes } = await initDefault()
    await mod.invoke('add_source', {
      sceneId: scenes[0].id, name: 'Webcam', sourceType: 'camera', settings: '{}',
    })

    const result = (await mod.invoke('duplicate_scene', {
      id: scenes[0].id, collectionId,
    })) as { scene: SceneDto; sources: SourceDto[] }

    expect(result.scene.name).toBe('Scene 1 (copy)')
    expect(result.sources).toHaveLength(1)
    expect(result.sources[0].name).toBe('Webcam')
    // A copy, not a reference to the original row.
    expect(result.sources[0].id).not.toBe(scenes[0].id)
  })

  it('rejects duplicating a scene that does not exist', async () => {
    await expect(
      mod.invoke('duplicate_scene', { id: 'missing', collectionId }),
    ).rejects.toMatch(/not found/i)
  })
})

describe('source commands', () => {
  let sceneId: string

  beforeEach(async () => {
    sceneId = (await initDefault()).scenes[0].id
  })

  const add = (name: string) =>
    mod.invoke('add_source', {
      sceneId, name, sourceType: 'display', settings: '{}',
    }) as Promise<SourceDto>

  it('creates a source visible by default', async () => {
    const source = await add('Display')
    expect(source.visible).toBe(true)
  })

  it('exposes visibility as a boolean, not SQLite’s 0/1', async () => {
    await add('Display')
    const [source] = (await mod.invoke('list_sources', { sceneId })) as SourceDto[]
    expect(typeof source.visible).toBe('boolean')
  })

  it('appends each source after the last', async () => {
    await add('First')
    const second = await add('Second')
    expect(second.orderIndex).toBe(1)
  })

  it('toggles visibility', async () => {
    const source = await add('Display')
    await mod.invoke('set_source_visible', { id: source.id, visible: false })

    const [updated] = (await mod.invoke('list_sources', { sceneId })) as SourceDto[]
    expect(updated.visible).toBe(false)
  })

  it('removes a source', async () => {
    const source = await add('Display')
    await mod.invoke('remove_source', { id: source.id })
    expect(await mod.invoke('list_sources', { sceneId })).toEqual([])
  })

  it('reorders sources', async () => {
    const a = await add('A')
    const b = await add('B')
    await mod.invoke('reorder_sources', { ids: [b.id, a.id] })

    const list = (await mod.invoke('list_sources', { sceneId })) as SourceDto[]
    expect(list.map((s) => s.name)).toEqual(['B', 'A'])
  })
})

describe('collection commands', () => {
  beforeEach(async () => {
    await initDefault()
  })

  it('creates a collection with a starting scene', async () => {
    const result = (await mod.invoke('create_collection', { name: 'Podcast' })) as {
      collection: CollectionDto
      scenes: SceneDto[]
    }
    expect(result.collection.name).toBe('Podcast')
    expect(result.scenes).toHaveLength(1)
  })

  it('refuses to delete the last remaining collection', async () => {
    const [only] = (await mod.invoke('list_collections')) as CollectionDto[]
    await expect(
      mod.invoke('delete_collection', { id: only.id }),
    ).rejects.toMatch(/last scene collection/i)
  })

  it('deletes a collection once another exists', async () => {
    const { collection } = (await mod.invoke('create_collection', {
      name: 'Second',
    })) as { collection: CollectionDto }

    await mod.invoke('delete_collection', { id: collection.id })

    const remaining = (await mod.invoke('list_collections')) as CollectionDto[]
    expect(remaining).toHaveLength(1)
  })

  it('deletes the scenes belonging to a removed collection', async () => {
    const { collection, scenes } = (await mod.invoke('create_collection', {
      name: 'Second',
    })) as { collection: CollectionDto; scenes: SceneDto[] }

    await mod.invoke('delete_collection', { id: collection.id })

    expect(await mod.invoke('list_scenes', { collectionId: collection.id })).toEqual([])
    expect(scenes).toHaveLength(1) // it did have one before the delete
  })

  it('duplicates a collection with its scenes and sources', async () => {
    const [original] = (await mod.invoke('list_collections')) as CollectionDto[]
    const scenes = (await mod.invoke('list_scenes', {
      collectionId: original.id,
    })) as SceneDto[]
    await mod.invoke('add_source', {
      sceneId: scenes[0].id, name: 'Display', sourceType: 'display', settings: '{}',
    })

    const copy = (await mod.invoke('duplicate_collection', { id: original.id })) as {
      collection: CollectionDto
      scenes: SceneDto[]
    }

    expect(copy.collection.name).toBe('Default (copy)')
    expect(copy.scenes).toHaveLength(1)

    const copiedSources = (await mod.invoke('list_sources', {
      sceneId: copy.scenes[0].id,
    })) as SourceDto[]
    expect(copiedSources).toHaveLength(1)
    expect(copiedSources[0].name).toBe('Display')
  })

  it('renames a collection', async () => {
    const [only] = (await mod.invoke('list_collections')) as CollectionDto[]
    await mod.invoke('rename_collection', { id: only.id, name: 'Renamed' })

    const [updated] = (await mod.invoke('list_collections')) as CollectionDto[]
    expect(updated.name).toBe('Renamed')
  })
})
