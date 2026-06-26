import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { generateId } from '@/lib/utils'
import {
  useSettingsStore,
  DEFAULT_GENERAL,
  DEFAULT_VIDEO,
  DEFAULT_AUDIO,
  type SettingsState,
} from './settingsStore'

const STORAGE_KEY = 'cb:profiles'
const ACTIVE_KEY  = 'cb:activeProfile'

export interface ProfileItem {
  id: string
  name: string
  settings: SettingsState
  createdAt: number
}

function captureSettings(): SettingsState {
  const { general, video, audio } = useSettingsStore.getState()
  return { general, video, audio }
}

function defaultProfile(): ProfileItem {
  return {
    id:       generateId(),
    name:     'Default',
    settings: { general: DEFAULT_GENERAL, video: DEFAULT_VIDEO, audio: DEFAULT_AUDIO },
    createdAt: Date.now(),
  }
}

function loadPersisted(): { profiles: ProfileItem[]; activeProfileId: string | null } {
  try {
    const raw      = localStorage.getItem(STORAGE_KEY)
    const profiles: ProfileItem[] = raw ? JSON.parse(raw) : []
    if (profiles.length === 0) {
      const def = defaultProfile()
      return { profiles: [def], activeProfileId: def.id }
    }
    const saved = localStorage.getItem(ACTIVE_KEY)
    const activeProfileId = saved && profiles.some((p) => p.id === saved) ? saved : profiles[0].id
    return { profiles, activeProfileId }
  } catch {
    const def = defaultProfile()
    return { profiles: [def], activeProfileId: def.id }
  }
}

function persist(profiles: ProfileItem[], activeProfileId: string | null) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles))
    if (activeProfileId) localStorage.setItem(ACTIVE_KEY, activeProfileId)
  } catch { /* ignore */ }
}

interface ProfileState {
  profiles: ProfileItem[]
  activeProfileId: string | null
}

interface ProfileActions {
  createProfile:    (name: string) => void
  renameProfile:    (id: string, name: string) => void
  deleteProfile:    (id: string) => void
  duplicateProfile: (id: string) => void
  switchProfile:    (id: string) => void
}

const initial = loadPersisted()

export const useProfileStore = create<ProfileState & ProfileActions>()(
  immer((set, get) => ({
    profiles:        initial.profiles,
    activeProfileId: initial.activeProfileId,

    createProfile: (name) => {
      const profile: ProfileItem = {
        id: generateId(), name, settings: captureSettings(), createdAt: Date.now(),
      }
      set((s) => { s.profiles.push(profile); s.activeProfileId = profile.id })
      persist(get().profiles, profile.id)
    },

    renameProfile: (id, name) => {
      set((s) => {
        const p = s.profiles.find((x) => x.id === id)
        if (p) p.name = name
      })
      persist(get().profiles, get().activeProfileId)
    },

    deleteProfile: (id) => {
      if (get().profiles.length <= 1) return
      const wasActive = get().activeProfileId === id

      set((s) => { s.profiles = s.profiles.filter((x) => x.id !== id) })

      const next = get().profiles[0]
      if (wasActive && next) {
        get().switchProfile(next.id)
      } else {
        persist(get().profiles, get().activeProfileId)
      }
    },

    duplicateProfile: (id) => {
      const orig = get().profiles.find((x) => x.id === id)
      if (!orig) return
      const copy: ProfileItem = {
        id: generateId(), name: `${orig.name} (copy)`, settings: orig.settings, createdAt: Date.now(),
      }
      set((s) => { s.profiles.push(copy) })
      persist(get().profiles, get().activeProfileId)
    },

    switchProfile: (id) => {
      const profile = get().profiles.find((x) => x.id === id)
      if (!profile) return
      set((s) => { s.activeProfileId = id })
      useSettingsStore.getState().applyAll(profile.settings)
      persist(get().profiles, id)
    },
  }))
)
