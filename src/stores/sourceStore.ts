import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { ipc, type SourceDto } from '@/ipc'
import { generateId } from '@/lib/utils'
import type { ID, SourceType } from '@/types'

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
  createdAt: number
  updatedAt: number
}

function fromDto(dto: SourceDto): SourceItem {
  let settings: Record<string, unknown> = {}
  try { settings = JSON.parse(dto.settings) } catch { /* keep empty */ }
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
    createdAt: now, updatedAt: now,
  }
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
  renameSource:   (sceneId: ID, sourceId: ID, name: string) => Promise<void>
  setVisible:     (sceneId: ID, sourceId: ID, visible: boolean) => Promise<void>
  setLocked:      (sceneId: ID, sourceId: ID, locked: boolean) => Promise<void>
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
      } catch {
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
      } catch { /* keep optimistic */ }
    },

    removeSource: async (sceneId, sourceId) => {
      set((s) => {
        if (s.byScene[sceneId]) {
          s.byScene[sceneId] = s.byScene[sceneId].filter((x) => x.id !== sourceId)
        }
      })
      try { await ipc.source.remove(sourceId) } catch { /* no-op */ }
    },

    renameSource: async (sceneId, sourceId, name) => {
      set((s) => {
        const src = s.byScene[sceneId]?.find((x) => x.id === sourceId)
        if (src) { src.name = name; src.updatedAt = Date.now() }
      })
      try { await ipc.source.rename(sourceId, name) } catch { /* no-op */ }
    },

    setVisible: async (sceneId, sourceId, visible) => {
      set((s) => {
        const src = s.byScene[sceneId]?.find((x) => x.id === sourceId)
        if (src) src.visible = visible
      })
      try { await ipc.source.setVisible(sourceId, visible) } catch { /* no-op */ }
    },

    setLocked: async (sceneId, sourceId, locked) => {
      set((s) => {
        const src = s.byScene[sceneId]?.find((x) => x.id === sourceId)
        if (src) src.locked = locked
      })
      try { await ipc.source.setLocked(sourceId, locked) } catch { /* no-op */ }
    },

    reorderSources: async (sceneId, ids) => {
      set((s) => {
        const current = s.byScene[sceneId] ?? []
        s.byScene[sceneId] = ids
          .map((id, i) => {
            const src = current.find((x) => x.id === id)
            if (src) src.orderIndex = i
            return src
          })
          .filter(Boolean) as SourceItem[]
      })
      try { await ipc.source.reorder(ids) } catch { /* no-op */ }
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
