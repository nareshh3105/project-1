import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { save, open } from '@tauri-apps/plugin-dialog'
import { writeTextFile, readTextFile } from '@tauri-apps/plugin-fs'
import { ipc, type CollectionDto, type SceneDto, type SourceDto } from '@/ipc'
import { useSceneStore } from './sceneStore'

const ACTIVE_KEY = 'cb:activeCollection'

export interface CollectionItem {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

function fromDto(dto: CollectionDto): CollectionItem {
  return { id: dto.id, name: dto.name, createdAt: dto.createdAt, updatedAt: dto.updatedAt }
}

interface ExportPayload {
  name: string
  scenes: SceneDto[]
  sourcesByScene: Record<string, SourceDto[]>
}

interface CollectionState {
  collections: CollectionItem[]
  activeCollectionId: string | null
  loading: boolean
  error: string | null
}

interface CollectionActions {
  loadCollections:      () => Promise<void>
  createCollection:     (name: string) => Promise<void>
  renameCollection:     (id: string, name: string) => Promise<void>
  deleteCollection:     (id: string) => Promise<void>
  duplicateCollection:  (id: string) => Promise<void>
  switchCollection:     (id: string) => Promise<void>
  exportCollection:     (id: string) => Promise<void>
  importCollection:     () => Promise<void>
}

export const useCollectionStore = create<CollectionState & CollectionActions>()(
  immer((set, get) => ({
    collections:        [],
    activeCollectionId: null,
    loading:             false,
    error:               null,

    loadCollections: async () => {
      set((s) => { s.loading = true })
      try {
        const dtos    = await ipc.collection.list()
        const items   = dtos.map(fromDto)
        const current = useSceneStore.getState().collectionId

        set((s) => {
          s.collections        = items
          s.activeCollectionId = current
          s.loading             = false
        })

        // Restore the previously active collection from a prior session, if different
        let saved: string | null = null
        try { saved = localStorage.getItem(ACTIVE_KEY) } catch { /* ignore */ }
        if (saved && saved !== current && items.some((c) => c.id === saved)) {
          await get().switchCollection(saved)
        }
      } catch {
        set((s) => { s.loading = false })
      }
    },

    createCollection: async (name) => {
      try {
        const result = await ipc.collection.create(name)
        set((s) => { s.collections.push(fromDto(result.collection)) })
        await get().switchCollection(result.collection.id)
      } catch { /* no-op */ }
    },

    renameCollection: async (id, name) => {
      set((s) => {
        const c = s.collections.find((x) => x.id === id)
        if (c) c.name = name
      })
      try { await ipc.collection.rename(id, name) } catch { /* no-op */ }
    },

    deleteCollection: async (id) => {
      if (get().collections.length <= 1) return
      const wasActive = get().activeCollectionId === id

      set((s) => { s.collections = s.collections.filter((x) => x.id !== id) })

      try {
        await ipc.collection.delete(id)
        if (wasActive) {
          const next = get().collections[0]
          if (next) await get().switchCollection(next.id)
        }
      } catch { /* no-op */ }
    },

    duplicateCollection: async (id) => {
      try {
        const result = await ipc.collection.duplicate(id)
        set((s) => { s.collections.push(fromDto(result.collection)) })
        await get().switchCollection(result.collection.id)
      } catch { /* no-op */ }
    },

    switchCollection: async (id) => {
      try {
        const scenes = await ipc.scene.list(id)
        useSceneStore.getState().loadCollection(id, scenes)
        set((s) => { s.activeCollectionId = id })
        try { localStorage.setItem(ACTIVE_KEY, id) } catch { /* ignore */ }
      } catch { /* no-op */ }
    },

    exportCollection: async (id) => {
      const collection = get().collections.find((c) => c.id === id)
      if (!collection) return

      try {
        const scenes = await ipc.scene.list(id)
        const sourcesByScene: Record<string, SourceDto[]> = {}
        for (const scene of scenes) {
          sourcesByScene[scene.id] = await ipc.source.list(scene.id)
        }

        const payload: ExportPayload = { name: collection.name, scenes, sourcesByScene }

        const path = await save({
          defaultPath: `${collection.name}.json`,
          filters: [{ name: 'Scene Collection', extensions: ['json'] }],
        })
        if (path) await writeTextFile(path, JSON.stringify(payload, null, 2))
      } catch { /* no-op */ }
    },

    importCollection: async () => {
      try {
        const path = await open({
          multiple: false,
          filters: [{ name: 'Scene Collection', extensions: ['json'] }],
        })
        if (!path || Array.isArray(path)) return

        const text = await readTextFile(path)
        const data = JSON.parse(text) as ExportPayload

        const result = await ipc.collection.create(data.name || 'Imported')

        // Drop the backend-created default "Scene 1" before recreating from the import
        for (const scene of result.scenes) {
          await ipc.scene.delete(scene.id)
        }

        for (const scene of data.scenes) {
          const newScene = await ipc.scene.create(result.collection.id, scene.name)
          const sources  = data.sourcesByScene[scene.id] ?? []
          for (const src of sources) {
            await ipc.source.add(newScene.id, src.name, src.sourceType, src.settings)
          }
        }

        set((s) => { s.collections.push(fromDto(result.collection)) })
        await get().switchCollection(result.collection.id)
      } catch { /* no-op */ }
    },
  }))
)
