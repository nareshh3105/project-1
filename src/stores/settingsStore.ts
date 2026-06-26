import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { GeneralSettings, VideoSettings } from '@/types/settings'
import type { AudioSettings } from '@/types/audio'
import { STANDARD_RESOLUTIONS, FRAME_RATES } from '@/types/common'

const STORAGE_KEY = 'cb:settings'

export const DEFAULT_GENERAL: GeneralSettings = {
  theme:                 'dark',
  language:              'en-US',
  systemTray:            true,
  confirmOnExit:         true,
  updateChannel:         'stable',
  autoCheckUpdates:      true,
  statsUpdateInterval:   2000,
}

export const DEFAULT_VIDEO: VideoSettings = {
  baseResolution:    STANDARD_RESOLUTIONS[2],   // 1920×1080
  outputResolution:  STANDARD_RESOLUTIONS[3],   // 1280×720
  fps:               30,
  fpsNumerator:      30,
  fpsDenominator:    1,
  downscaleFilter:   'bicubic',
  colorFormat:       'NV12',
  colorSpace:        '709',
  colorRange:        'partial',
  gpuConversion:     true,
}

export const DEFAULT_AUDIO: AudioSettings = {
  sampleRate:      48000,
  channels:        2,
  desktopDevice1:  'default',
  desktopDevice2:  'disabled',
  auxDevice1:      'default',
  auxDevice2:      'disabled',
  auxDevice3:      'disabled',
}

export interface SettingsState {
  general: GeneralSettings
  video:   VideoSettings
  audio:   AudioSettings
}

interface SettingsActions {
  updateGeneral: (patch: Partial<GeneralSettings>) => void
  updateVideo:   (patch: Partial<VideoSettings>)   => void
  updateAudio:   (patch: Partial<AudioSettings>)   => void
  applyAll:      (draft: SettingsState) => void
}

function load(): Partial<SettingsState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function save(state: SettingsState) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)) } catch { /* ignore */ }
}

const persisted = load()

export const useSettingsStore = create<SettingsState & SettingsActions>()(
  immer((set, get) => ({
    general: { ...DEFAULT_GENERAL, ...(persisted.general ?? {}) },
    video:   { ...DEFAULT_VIDEO,   ...(persisted.video   ?? {}) },
    audio:   { ...DEFAULT_AUDIO,   ...(persisted.audio   ?? {}) },

    updateGeneral: (patch) => set((s) => {
      Object.assign(s.general, patch)
      save({ general: s.general, video: s.video, audio: s.audio })
    }),

    updateVideo: (patch) => set((s) => {
      Object.assign(s.video, patch)
      save({ general: s.general, video: s.video, audio: s.audio })
    }),

    updateAudio: (patch) => set((s) => {
      Object.assign(s.audio, patch)
      save({ general: s.general, video: s.video, audio: s.audio })
    }),

    applyAll: (draft) => set((s) => {
      s.general = draft.general
      s.video   = draft.video
      s.audio   = draft.audio
      save(draft)
    }),
  }))
)

// Re-export so SettingsModal can build options without importing common directly
export { STANDARD_RESOLUTIONS, FRAME_RATES }
