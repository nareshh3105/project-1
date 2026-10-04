import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { ipc, type SceneDto } from '@/ipc'
import { generateId } from '@/lib/utils'
import { useCaptureStore } from './captureStore'
import { reportFailure, describeError, useNotifyStore } from './notifyStore'
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

/**
 * Fetches a scene's sources. Goes through loadSources, which reports a failure
 * and leaves the list usable. The chain this replaced returned nothing from its
 * inner promise, so an error there was unhandled, and the outer catch swallowed
 * the rest: a scene whose sources failed to load just looked empty.
 */
function loadSourcesFor(sceneId: ID) {
  void import('./sourceStore').then(({ useSourceStore }) => useSourceStore.getState().loadSources(sceneId))
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
      } catch (err) {
        // Falling back to an in-memory scene keeps the window usable, but
        // everything done from here is lost on exit. Doing that silently let a
        // database that failed to open look like a working project.
        useNotifyStore.getState().notify(
          'error',
          `Couldn't open your project: ${describeError(err)}. Changes made now won't be saved.`,
        )
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
        loadSourcesFor(scenes[0].id)
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
      } catch (err) {
        set((s) => { s.scenes = s.scenes.filter((x) => x.id !== optimistic.id) })
        reportFailure('add the scene', err)
      }
    },

    renameScene: async (id, name) => {
      const previous = get().scenes.find((x) => x.id === id)?.name
      set((s) => {
        const scene = s.scenes.find((x) => x.id === id)
        if (scene) { scene.name = name; scene.updatedAt = Date.now() }
      })
      try {
        await ipc.scene.rename(id, name)
      } catch (err) {
        if (previous !== undefined) {
          set((s) => {
            const scene = s.scenes.find((x) => x.id === id)
            if (scene) scene.name = previous
          })
        }
        reportFailure('rename the scene', err)
      }
    },

    deleteScene: async (id) => {
      const { scenes, activeSceneId } = get()
      const remaining = scenes.filter((s) => s.id !== id)
      const index = scenes.findIndex((s) => s.id === id)
      const removed = scenes[index]

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

      try {
        await ipc.scene.delete(id)
      } catch (err) {
        // It still exists in the database, so bring it back with its sources.
        if (removed) {
          set((s) => {
            if (!s.scenes.some((x) => x.id === id)) s.scenes.splice(Math.min(index, s.scenes.length), 0, removed)
            if (activeSceneId === id) s.activeSceneId = id
          })
          void useSourceStore.getState().loadSources(id)
        }
        reportFailure('delete the scene', err)
      }
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
      } catch (err) {
        set((s) => { s.scenes = s.scenes.filter((x) => x.id !== copy.id) })
        reportFailure('duplicate the scene', err)
      }
    },

    reorderScenes: async (ids) => {
      const previous = get().scenes.map((x) => x.id)
      const arrange = (order: ID[]) => set((s) => {
        s.scenes = order
          .map((id, i) => {
            const scene = s.scenes.find((x) => x.id === id)
            if (scene) scene.orderIndex = i
            return scene
          })
          .filter(Boolean) as SceneItem[]
      })
      arrange(ids)
      try {
        await ipc.scene.reorder(ids)
      } catch (err) {
        arrange(previous)
        reportFailure('reorder the scenes', err)
      }
    },

    setActiveScene: (id) => {
      set((s) => { s.activeSceneId = id })
      // Lazy-load sources on scene switch
      loadSourcesFor(id)
    },

    setPreviewScene: (id) => {
      set((s) => { s.previewSceneId = id })
      // A staged scene is shown in the preview, and brought in by a transition,
      // before it has ever been on air: its sources have to be there.
      loadSourcesFor(id)
    },
  }))
)
