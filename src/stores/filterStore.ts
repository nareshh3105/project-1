import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { generateId } from '@/lib/utils'

// ── Filter types ──────────────────────────────────────────────────────────────

export type FilterType = 'color-correction' | 'crop' | 'chroma-key'

interface FilterBase {
  id: string
  type: FilterType
  name: string
  enabled: boolean
}

export interface ColorCorrectionFilter extends FilterBase {
  type: 'color-correction'
  brightness: number  // -1 to 1
  contrast: number    // 0 to 4
  saturation: number  // 0 to 4
  hue: number         // -180 to 180
  opacity: number     // 0 to 1
}

export interface CropFilter extends FilterBase {
  type: 'crop'
  left: number
  right: number
  top: number
  bottom: number
}

export interface ChromaKeyFilter extends FilterBase {
  type: 'chroma-key'
  keyColor: string    // hex
  similarity: number  // 1-1000
  smoothness: number  // 1-1000
  opacity: number     // 0 to 1
}

export type SourceFilter = ColorCorrectionFilter | CropFilter | ChromaKeyFilter

export function filterLabel(type: FilterType): string {
  switch (type) {
    case 'color-correction': return 'Color Correction'
    case 'crop':             return 'Crop / Pad'
    case 'chroma-key':       return 'Chroma Key'
  }
}

function defaultFilter(type: FilterType): SourceFilter {
  const base = { id: generateId(), type, name: filterLabel(type), enabled: true }
  switch (type) {
    case 'color-correction':
      return { ...base, type: 'color-correction', brightness: 0, contrast: 1, saturation: 1, hue: 0, opacity: 1 }
    case 'crop':
      return { ...base, type: 'crop', left: 0, right: 0, top: 0, bottom: 0 }
    case 'chroma-key':
      return { ...base, type: 'chroma-key', keyColor: '#00ff00', similarity: 80, smoothness: 50, opacity: 1 }
  }
}

// ── Persistence ───────────────────────────────────────────────────────────────

const STORAGE_KEY = 'cb:filters'

function loadPersisted(): Record<string, SourceFilter[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function persist(data: Record<string, SourceFilter[]>) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)) } catch { /* ignore */ }
}

// ── Store ─────────────────────────────────────────────────────────────────────

interface FilterState {
  filtersBySource: Record<string, SourceFilter[]>
  selectedFilterId: string | null

  addFilter:    (sourceId: string, type: FilterType) => void
  removeFilter: (sourceId: string, filterId: string) => void
  updateFilter: (sourceId: string, filterId: string, patch: Partial<SourceFilter>) => void
  toggleFilter: (sourceId: string, filterId: string) => void
  setSelectedFilter: (id: string | null) => void
}

export const useFilterStore = create<FilterState>()(
  immer((set, get) => ({
    filtersBySource:  loadPersisted(),
    selectedFilterId: null,

    addFilter: (sourceId, type) => {
      const filter = defaultFilter(type)
      set((s) => {
        if (!s.filtersBySource[sourceId]) s.filtersBySource[sourceId] = []
        s.filtersBySource[sourceId].push(filter)
        s.selectedFilterId = filter.id
      })
      persist(get().filtersBySource)
    },

    removeFilter: (sourceId, filterId) => {
      set((s) => {
        if (!s.filtersBySource[sourceId]) return
        s.filtersBySource[sourceId] = s.filtersBySource[sourceId].filter((f) => f.id !== filterId)
        if (s.selectedFilterId === filterId) {
          const remaining = s.filtersBySource[sourceId]
          s.selectedFilterId = remaining.length > 0 ? remaining[0].id : null
        }
      })
      persist(get().filtersBySource)
    },

    updateFilter: (sourceId, filterId, patch) => {
      set((s) => {
        const list = s.filtersBySource[sourceId]
        if (!list) return
        const idx = list.findIndex((f) => f.id === filterId)
        if (idx !== -1) Object.assign(list[idx], patch)
      })
      persist(get().filtersBySource)
    },

    toggleFilter: (sourceId, filterId) => {
      set((s) => {
        const filter = s.filtersBySource[sourceId]?.find((f) => f.id === filterId)
        if (filter) filter.enabled = !filter.enabled
      })
      persist(get().filtersBySource)
    },

    setSelectedFilter: (id) =>
      set((s) => { s.selectedFilterId = id }),
  }))
)
