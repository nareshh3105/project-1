import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { readPersisted, writePersisted, isRecord } from '@/lib/persist'
import type { GeneralSettings, VideoSettings } from '@/types/settings'
import type { AudioSettings } from '@/types/audio'
import { STANDARD_RESOLUTIONS, FRAME_RATES } from '@/types/common'

const STORAGE_KEY = 'cb:settings'

export interface RecordingConfig {
  format:       'mkv' | 'mp4'
  outputFolder: string     // empty = default ~/Videos
  /** Video bitrate in kbit/s; 0 picks one to suit the resolution and frame rate. */
  videoBitrateKbps: number
  audioBitrateKbps: number
  encoder:      'auto' | 'hardware' | 'software'
}

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

export const DEFAULT_RECORDING: RecordingConfig = {
  format:       'mkv',
  outputFolder: '',
  videoBitrateKbps: 0,
  audioBitrateKbps: 160,
  encoder:      'auto',
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
  general:   GeneralSettings
  video:     VideoSettings
  audio:     AudioSettings
  recording: RecordingConfig
}

interface SettingsActions {
  updateGeneral:    (patch: Partial<GeneralSettings>)  => void
  updateVideo:      (patch: Partial<VideoSettings>)    => void
  updateAudio:      (patch: Partial<AudioSettings>)    => void
  updateRecording:  (patch: Partial<RecordingConfig>)  => void
  applyAll:         (draft: SettingsState) => void
}

/**
 * Each section is merged field-by-field over its defaults below, so this only
 * has to guarantee that what comes back is a record of records. A stored
 * `null` used to reach `persisted.general` and throw before the first render.
 *
 * Individual leaves are not validated, with one exception: baseResolution is
 * read by the scene compositor as `base.width`, so a malformed one would take
 * the preview down rather than degrade.
 */
const isSettingsShape = (v: unknown): v is Partial<SettingsState> =>
  isRecord(v) && Object.values(v).every(isRecord)

function load(): Partial<SettingsState> {
  const loaded = readPersisted<Partial<SettingsState>>(STORAGE_KEY, isSettingsShape, () => ({}))
  const video = loaded.video as Partial<SettingsState['video']> | undefined
  const res: unknown = video?.baseResolution
  const usable =
    isRecord(res) &&
    typeof res.width === 'number' && res.width > 0 &&
    typeof res.height === 'number' && res.height > 0
  if (video && !usable) delete video.baseResolution
  return loaded
}

function save(state: SettingsState) {
  writePersisted(STORAGE_KEY, state)
}

const persisted = load()

export const useSettingsStore = create<SettingsState & SettingsActions>()(
  immer((set) => ({
    general:   { ...DEFAULT_GENERAL,   ...(persisted.general   ?? {}) },
    video:     { ...DEFAULT_VIDEO,     ...(persisted.video     ?? {}) },
    audio:     { ...DEFAULT_AUDIO,     ...(persisted.audio     ?? {}) },
    recording: { ...DEFAULT_RECORDING, ...(persisted.recording ?? {}) },

    updateGeneral: (patch) => set((s) => {
      Object.assign(s.general, patch)
      save({ general: s.general, video: s.video, audio: s.audio, recording: s.recording })
    }),

    updateVideo: (patch) => set((s) => {
      Object.assign(s.video, patch)
      save({ general: s.general, video: s.video, audio: s.audio, recording: s.recording })
    }),

    updateAudio: (patch) => set((s) => {
      Object.assign(s.audio, patch)
      save({ general: s.general, video: s.video, audio: s.audio, recording: s.recording })
    }),

    updateRecording: (patch) => set((s) => {
      Object.assign(s.recording, patch)
      save({ general: s.general, video: s.video, audio: s.audio, recording: s.recording })
    }),

    applyAll: (draft) => set((s) => {
      s.general   = draft.general
      s.video     = draft.video
      s.audio     = draft.audio
      s.recording = draft.recording
      save(draft)
    }),
  }))
)

// Re-export so SettingsModal can build options without importing common directly
export { STANDARD_RESOLUTIONS, FRAME_RATES }
