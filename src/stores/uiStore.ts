import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { STORAGE_KEYS } from '@/lib/constants'

// ── Modal registry ────────────────────────────────────────────────────────

export type ModalType =
  | 'settings'
  | 'stream-settings'
  | 'filters'
  | 'source-properties'
  | 'scene-collection'
  | 'profile-manager'
  | 'add-source'
  | 'confirm'
  | 'rename'
  | 'plugins'
  | 'about'
  | 'auto-config'
  | 'multiview'
  | 'stats'
  | 'updater'

export interface ModalState {
  type: ModalType
  payload?: unknown
}

// ── Context menu ──────────────────────────────────────────────────────────

export type ContextMenuTarget = 'scene' | 'source' | 'mixer-channel' | 'dock'

export interface ContextMenuState {
  target: ContextMenuTarget
  targetId: string | null
  x: number
  y: number
}

// ── Stats overlay ─────────────────────────────────────────────────────────

export interface RuntimeStats {
  cpuPercent: number
  memoryMb: number
  gpuPercent: number
  renderFps: number
  encodeFps: number
  skippedFramesRender: number
  skippedFramesEncode: number
  outputBitrateBps: number
  networkBps: number
  diskWriteMbps: number
}

// ── Store ─────────────────────────────────────────────────────────────────

interface UIState {
  // Dock layout (FlexLayout model JSON, persisted)
  layoutJson: string | null

  // Active modal (only one at a time)
  modal: ModalState | null

  // Context menu
  contextMenu: ContextMenuState | null

  // Studio Mode — preview panel shows a different scene than program
  studioMode: boolean

  // Stats overlay visible in toolbar
  statsOverlayVisible: boolean
  stats: RuntimeStats | null

  // App-level loading
  appReady: boolean
}

interface UIActions {
  setLayoutJson: (json: string) => void

  openModal: (type: ModalType, payload?: unknown) => void
  closeModal: () => void

  showContextMenu: (state: ContextMenuState) => void
  hideContextMenu: () => void

  toggleStudioMode: () => void
  setStudioMode: (enabled: boolean) => void

  toggleStatsOverlay: () => void
  setStats: (stats: RuntimeStats) => void

  setAppReady: (ready: boolean) => void
}

function loadPersistedLayout(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEYS.LAYOUT)
  } catch {
    return null
  }
}

export const useUIStore = create<UIState & UIActions>()(
  immer((set) => ({
    layoutJson: loadPersistedLayout(),
    modal: null,
    contextMenu: null,
    studioMode: false,
    statsOverlayVisible: false,
    stats: null,
    appReady: false,

    setLayoutJson: (json) =>
      set((s) => {
        s.layoutJson = json
        try { localStorage.setItem(STORAGE_KEYS.LAYOUT, json) } catch { /* ignore */ }
      }),

    openModal: (type, payload) =>
      set((s) => { s.modal = { type, payload } }),

    closeModal: () =>
      set((s) => { s.modal = null }),

    showContextMenu: (state) =>
      set((s) => { s.contextMenu = state }),

    hideContextMenu: () =>
      set((s) => { s.contextMenu = null }),

    toggleStudioMode: () =>
      set((s) => { s.studioMode = !s.studioMode }),

    setStudioMode: (enabled) =>
      set((s) => { s.studioMode = enabled }),

    toggleStatsOverlay: () =>
      set((s) => { s.statsOverlayVisible = !s.statsOverlayVisible }),

    setStats: (stats) =>
      set((s) => { s.stats = stats }),

    setAppReady: (ready) =>
      set((s) => { s.appReady = ready }),
  }))
)
