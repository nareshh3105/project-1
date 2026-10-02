import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { ipc, type SceneDto } from '@/ipc'
import { generateId } from '@/lib/utils'
import { useCaptureStore } from './captureStore'
import type { ID } from '@/types'

// ── Domain types (client-side) ─────────────────────────────────────────────

export interface SceneItem {
  id: ID
  collectionId: string
  name: string
  orderIndex: number
  createdAt: number
  updatedAt: number
}

function fromDto(dto: SceneDto): SceneItem {
  return {
    id:           dto.id,
    collectionId: dto.collectionId,
    name:         dto.name,
    orderIndex:   dto.orderIndex,
    createdAt:    dto.createdAt,
    updatedAt:    dto.updatedAt,
  }
}

function makeLocalScene(name: string, collectionId: string, orderIndex: number): SceneItem {
  const now = Date.now()
  return { id: generateId(), collectionId, name, orderIndex, createdAt: now, updatedAt: now }
}

/**
 * The lowest "Scene N" not already taken. Counting existing scenes instead
 * collides as soon as one is deleted: with Scene 1 and Scene 3 left, the
 * count is two and the next scene came out as a second "Scene 3".
 */
export function nextSceneName(existing: readonly string[]): string {
  const taken = new Set(existing)
  let n = 1
  while (taken.has(`Scene ${n}`)) n++
  return `Scene ${n}`
}

// ── State & actions ────────────────────────────────────────────────────────

interface SceneState {
  collectionId: string | null
  scenes: SceneItem[]
  activeSceneId: string | null
  previewSceneId: string | null   // Studio Mode
  loading: boolean
  error: string | null
}

interface SceneActions {
  initApp: () => Promise<void>
  loadCollection: (collectionId: ID, scenes: SceneItem[]) => void
  createScene: (name: string) => Promise<void>
  renameScene: (id: ID, name: string) => Promise<void>
  deleteScene: (id: ID) => Promise<void>
  duplicateScene: (id: ID) => Promise<void>
  reorderScenes: (ids: ID[]) => Promise<void>
  setActiveScene: (id: ID) => void
  setPreviewScene: (id: ID) => void
}

export const useSceneStore = create<SceneState & SceneActions>()(
  immer((set, get) => ({
    collectionId:   null,
    scenes:         [],
    activeSceneId:  null,
    previewSceneId: null,
    loading:        false,
    error:          null,

    // ── Init ────────────────────────────────────────────────────────────

    initApp: async () => {
      set((s) => { s.loading = true; s.error = null })
      try {
        const result = await ipc.scene.initDefault()
        const scenes = result.scenes.map(fromDto)
        set((s) => {
          s.collectionId  = result.collectionId
          s.scenes        = scenes
          s.activeSceneId = scenes[0]?.id ?? null
          s.loading       = false
        })
        // Load sources for the first scene
        if (scenes[0]) {
          const { useSourceStore } = await import('./sourceStore')
          await useSourceStore.getState().loadSources(scenes[0].id)
        }
      } catch {
        // Tauri not available (browser dev) — seed in-memory
        const cid  = 'default'
        const seed = makeLocalScene('Scene 1', cid, 0)
        set((s) => {
          s.collectionId  = cid
          s.scenes        = [seed]
          s.activeSceneId = seed.id
          s.loading       = false
        })
      }
    },

    // ── Scene Collections ────────────────────────────────────────────────

    loadCollection: (collectionId, scenes) => {
      // The previous collection's sources are gone; so are the controls for
      // any capture still running on their behalf.
      useCaptureStore.getState().stopAll()
      set((s) => {
        s.collectionId   = collectionId
        s.scenes         = scenes
        s.activeSceneId  = scenes[0]?.id ?? null
        s.previewSceneId = null
      })
      if (scenes[0]) {
        ipc.source.list(scenes[0].id).then((dtos) => {
          import('./sourceStore').then(({ useSourceStore }) => {
            useSourceStore.getState().seedSources(scenes[0].id, dtos)
          })
        }).catch(() => { /* browser dev — no-op */ })
      }
    },

    // ── Scene CRUD ───────────────────────────────────────────────────────

    createScene: async (name) => {
      const { collectionId, scenes } = get()
      if (!collectionId) return

      const optimistic = makeLocalScene(name, collectionId, scenes.length)
      set((s) => { s.scenes.push(optimistic) })

      try {
        const dto = await ipc.scene.create(collectionId, name)
        set((s) => {
          const idx = s.scenes.findIndex((x) => x.id === optimistic.id)
          if (idx !== -1) s.scenes[idx] = fromDto(dto)
        })
      } catch {
        // Keep optimistic state (in-memory only when Tauri unavailable)
      }
    },

    renameScene: async (id, name) => {
      set((s) => {
        const scene = s.scenes.find((x) => x.id === id)
        if (scene) { scene.name = name; scene.updatedAt = Date.now() }
      })
      try { await ipc.scene.rename(id, name) } catch { /* no-op */ }
    },

    deleteScene: async (id) => {
      const { scenes, activeSceneId } = get()
      const remaining = scenes.filter((s) => s.id !== id)

      // Release the scene's captures before its sources leave memory.
      const { useSourceStore } = await import('./sourceStore')
      useSourceStore.getState().forgetScene(id)

      set((s) => {
        s.scenes = remaining
        // A scene staged in Studio Mode that no longer exists would otherwise
        // stay referenced and render as an empty preview.
        if (s.previewSceneId === id) s.previewSceneId = null
        if (s.activeSceneId === id) s.activeSceneId = remaining[0]?.id ?? null
      })

      // Going through setActiveScene loads the replacement's sources; assigning
      // the id directly left it showing nothing until it was clicked again.
      if (activeSceneId === id && remaining[0]) get().setActiveScene(remaining[0].id)

      try { await ipc.scene.delete(id) } catch { /* no-op */ }
    },

    duplicateScene: async (id) => {
      const { collectionId, scenes } = get()
      if (!collectionId) return

      const orig = scenes.find((s) => s.id === id)
      if (!orig) return

      const copy = makeLocalScene(`${orig.name} (copy)`, collectionId, scenes.length)
      set((s) => { s.scenes.push(copy) })

      try {
        const result = await ipc.scene.duplicate(id, collectionId)
        set((s) => {
          const idx = s.scenes.findIndex((x) => x.id === copy.id)
          if (idx !== -1) s.scenes[idx] = fromDto(result.scene)
        })
        // Copy sources into sourceStore
        if (result.sources.length > 0) {
          const { useSourceStore } = await import('./sourceStore')
          useSourceStore.getState().seedSources(result.scene.id, result.sources)
        }
      } catch { /* keep optimistic */ }
    },

    reorderScenes: async (ids) => {
      set((s) => {
        s.scenes = ids
          .map((id, i) => {
            const scene = s.scenes.find((x) => x.id === id)
            if (scene) scene.orderIndex = i
            return scene
          })
          .filter(Boolean) as SceneItem[]
      })
      try { await ipc.scene.reorder(ids) } catch { /* no-op */ }
    },

    setActiveScene: (id) => {
      set((s) => { s.activeSceneId = id })
      // Lazy-load sources on scene switch
      ipc.source.list(id).then((dtos) => {
        import('./sourceStore').then(({ useSourceStore }) => {
          useSourceStore.getState().seedSources(id, dtos)
        })
      }).catch(() => { /* browser dev — no-op */ })
    },

    setPreviewScene: (id) => {
      set((s) => { s.previewSceneId = id })
    },
  }))
)
