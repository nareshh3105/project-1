import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { ipc, type SourceDto } from '@/ipc'
import { generateId } from '@/lib/utils'
import { useCaptureStore } from './captureStore'
import { reportFailure } from './notifyStore'
import type { ID, SourceType, Transform } from '@/types'

// ── Domain type ────────────────────────────────────────────────────────────

export interface SourceItem {
  id: ID
  sceneId: string
  name: string
  sourceType: SourceType
  settings: Record<string, unknown>
  orderIndex: number
  visible: boolean
  locked: boolean
  muted: boolean
  volume: number
  /** Placement on the scene canvas, in canvas pixels. */
  transform: Transform
  createdAt: number
  updatedAt: number
}

export const DEFAULT_TRANSFORM: Transform = {
  x: 0, y: 0, width: 1920, height: 1080, rotation: 0, scaleX: 1, scaleY: 1,
}

function fromDto(dto: SourceDto): SourceItem {
  let settings: Record<string, unknown> = {}
  try { settings = JSON.parse(dto.settings) } catch { /* keep empty */ }

  // A malformed or partial transform falls back field by field rather than
  // discarding the whole placement.
  let transform: Transform = DEFAULT_TRANSFORM
  try {
    transform = { ...DEFAULT_TRANSFORM, ...JSON.parse(dto.transform) }
  } catch { /* keep default */ }
  return {
    id:         dto.id,
    sceneId:    dto.sceneId,
    name:       dto.name,
    sourceType: dto.sourceType,
    settings,
    orderIndex: dto.orderIndex,
    visible:    dto.visible,
    locked:     dto.locked,
    muted:      dto.muted,
    volume:     dto.volume,
    transform,
    createdAt:  dto.createdAt,
    updatedAt:  dto.updatedAt,
  }
}

function makeLocalSource(sceneId: string, name: string, type: SourceType, orderIndex: number): SourceItem {
  const now = Date.now()
  return {
    id: generateId(), sceneId, name, sourceType: type,
    settings: {}, orderIndex,
    visible: true, locked: false, muted: false, volume: 1,
    transform: { ...DEFAULT_TRANSFORM },
    createdAt: now, updatedAt: now,
  }
}

/** `current` rearranged into the order of `ids`, renumbering orderIndex. */
function reordered(current: SourceItem[], ids: ID[]): SourceItem[] {
  return ids
    .map((id, i) => {
      const src = current.find((x) => x.id === id)
      if (src) src.orderIndex = i
      return src
    })
    .filter(Boolean) as SourceItem[]
}

// ── State & actions ────────────────────────────────────────────────────────

interface SourceState {
  // sceneId → sources (display order: index 0 = top layer in UI)
  byScene: Record<string, SourceItem[]>
  loading: boolean
  error: string | null
}

interface SourceActions {
  loadSources:    (sceneId: ID) => Promise<void>
  seedSources:    (sceneId: ID, dtos: SourceDto[]) => void
  addSource:      (sceneId: ID, name: string, type: SourceType) => Promise<void>
  removeSource:   (sceneId: ID, sourceId: ID) => Promise<void>
  forgetScene:    (sceneId: ID) => void
  renameSource:   (sceneId: ID, sourceId: ID, name: string) => Promise<void>
  setVisible:     (sceneId: ID, sourceId: ID, visible: boolean) => Promise<void>
  setLocked:      (sceneId: ID, sourceId: ID, locked: boolean) => Promise<void>
  setTransform:   (sceneId: ID, sourceId: ID, patch: Partial<Transform>) => void
  commitTransform:(sceneId: ID, sourceId: ID) => Promise<void>
  reorderSources: (sceneId: ID, ids: ID[]) => Promise<void>
  moveUp:         (sceneId: ID, sourceId: ID) => Promise<void>
  moveDown:       (sceneId: ID, sourceId: ID) => Promise<void>
}

export const useSourceStore = create<SourceState & SourceActions>()(
  immer((set, get) => ({
    byScene: {},
    loading: false,
    error:   null,

    loadSources: async (sceneId) => {
      set((s) => { s.loading = true })
      try {
        const dtos = await ipc.source.list(sceneId)
        set((s) => {
          s.byScene[sceneId] = dtos.map(fromDto)
          s.loading = false
        })
      } catch (err) {
        reportFailure('load the sources', err)
        set((s) => {
          if (!s.byScene[sceneId]) s.byScene[sceneId] = []
          s.loading = false
        })
      }
    },

    seedSources: (sceneId, dtos) => {
      set((s) => { s.byScene[sceneId] = dtos.map(fromDto) })
    },

    addSource: async (sceneId, name, type) => {
      const existing = get().byScene[sceneId] ?? []
      const optimistic = makeLocalSource(sceneId, name, type, existing.length)

      set((s) => {
        if (!s.byScene[sceneId]) s.byScene[sceneId] = []
        s.byScene[sceneId].push(optimistic)
      })

      try {
        const dto = await ipc.source.add(sceneId, name, type, '{}')
        set((s) => {
          const list = s.byScene[sceneId]
          const idx  = list?.findIndex((x) => x.id === optimistic.id)
          if (idx !== undefined && idx !== -1 && list) list[idx] = fromDto(dto)
        })
      } catch (err) {
        // Keeping the optimistic row would show a source that was never saved
        // and is gone after the next launch.
        set((s) => {
          s.byScene[sceneId] = (s.byScene[sceneId] ?? []).filter((x) => x.id !== optimistic.id)
        })
        reportFailure('add the source', err)
      }
    },

    removeSource: async (sceneId, sourceId) => {
      // A screen or camera capture keeps running after its source is gone
      // unless something stops it, and with the source removed there is no
      // control left on screen to do so. Doing it here covers every caller;
      // the toolbar's remove button used to skip it.
      useCaptureStore.getState().stopCapture(sourceId)

      const list = get().byScene[sceneId] ?? []
      const index = list.findIndex((x) => x.id === sourceId)
      const removed = list[index]

      set((s) => {
        if (s.byScene[sceneId]) {
          s.byScene[sceneId] = s.byScene[sceneId].filter((x) => x.id !== sourceId)
        }
      })
      try {
        await ipc.source.remove(sourceId)
      } catch (err) {
        // Put it back where it was; it still exists in the database.
        if (removed) {
          set((s) => {
            const current = (s.byScene[sceneId] ??= [])
            if (!current.some((x) => x.id === sourceId)) {
              current.splice(Math.min(index, current.length), 0, removed)
            }
          })
        }
        reportFailure('remove the source', err)
      }
    },

    /** Drops a deleted scene's sources from memory, releasing any capture they held. */
    forgetScene: (sceneId) => {
      const capture = useCaptureStore.getState()
      for (const src of get().byScene[sceneId] ?? []) capture.stopCapture(src.id)
      set((s) => { delete s.byScene[sceneId] })
    },

    renameSource: async (sceneId, sourceId, name) => {
      const previous = get().byScene[sceneId]?.find((x) => x.id === sourceId)?.name
      set((s) => {
        const src = s.byScene[sceneId]?.find((x) => x.id === sourceId)
        if (src) { src.name = name; src.updatedAt = Date.now() }
      })
      try {
        await ipc.source.rename(sourceId, name)
      } catch (err) {
        if (previous !== undefined) {
          set((s) => {
            const src = s.byScene[sceneId]?.find((x) => x.id === sourceId)
            if (src) src.name = previous
          })
        }
        reportFailure('rename the source', err)
      }
    },

    setVisible: async (sceneId, sourceId, visible) => {
      const previous = get().byScene[sceneId]?.find((x) => x.id === sourceId)?.visible
      set((s) => {
        const src = s.byScene[sceneId]?.find((x) => x.id === sourceId)
        if (src) src.visible = visible
      })
      try {
        await ipc.source.setVisible(sourceId, visible)
      } catch (err) {
        if (previous !== undefined) {
          set((s) => {
            const src = s.byScene[sceneId]?.find((x) => x.id === sourceId)
            if (src) src.visible = previous
          })
        }
        reportFailure(visible ? 'show the source' : 'hide the source', err)
      }
    },

    setLocked: async (sceneId, sourceId, locked) => {
      const previous = get().byScene[sceneId]?.find((x) => x.id === sourceId)?.locked
      set((s) => {
        const src = s.byScene[sceneId]?.find((x) => x.id === sourceId)
        if (src) src.locked = locked
      })
      try {
        await ipc.source.setLocked(sourceId, locked)
      } catch (err) {
        if (previous !== undefined) {
          set((s) => {
            const src = s.byScene[sceneId]?.find((x) => x.id === sourceId)
            if (src) src.locked = previous
          })
        }
        reportFailure(locked ? 'lock the source' : 'unlock the source', err)
      }
    },

    /**
     * Applies a placement change locally. Dragging fires this on every pointer
     * move, so it deliberately does not touch the backend — commitTransform
     * persists once the gesture ends.
     */
    setTransform: (sceneId, sourceId, patch) => {
      set((s) => {
        const src = s.byScene[sceneId]?.find((x) => x.id === sourceId)
        if (!src || src.locked) return
        src.transform = { ...src.transform, ...patch }
        src.updatedAt = Date.now()
      })
    },

    commitTransform: async (sceneId, sourceId) => {
      const src = get().byScene[sceneId]?.find((x) => x.id === sourceId)
      if (!src) return
      try {
        await ipc.source.setTransform(sourceId, JSON.stringify(src.transform))
      } catch (err) {
        // The placement stays where the user dragged it, so their work is not
        // snatched back mid-gesture, but they are told it was not saved.
        reportFailure('save the source position', err)
      }
    },

    reorderSources: async (sceneId, ids) => {
      const previous = (get().byScene[sceneId] ?? []).map((x) => x.id)
      set((s) => { s.byScene[sceneId] = reordered(s.byScene[sceneId] ?? [], ids) })
      try {
        await ipc.source.reorder(ids)
      } catch (err) {
        set((s) => { s.byScene[sceneId] = reordered(s.byScene[sceneId] ?? [], previous) })
        reportFailure('reorder the sources', err)
      }
    },

    moveUp: async (sceneId, sourceId) => {
      const sources = get().byScene[sceneId] ?? []
      const idx = sources.findIndex((x) => x.id === sourceId)
      if (idx <= 0) return
      const newOrder = [...sources]
      ;[newOrder[idx - 1], newOrder[idx]] = [newOrder[idx], newOrder[idx - 1]]
      await get().reorderSources(sceneId, newOrder.map((x) => x.id))
    },

    moveDown: async (sceneId, sourceId) => {
      const sources = get().byScene[sceneId] ?? []
      const idx = sources.findIndex((x) => x.id === sourceId)
      if (idx < 0 || idx >= sources.length - 1) return
      const newOrder = [...sources]
      ;[newOrder[idx], newOrder[idx + 1]] = [newOrder[idx + 1], newOrder[idx]]
      await get().reorderSources(sceneId, newOrder.map((x) => x.id))
    },
  }))
)
