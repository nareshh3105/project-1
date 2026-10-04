import { STANDARD_RESOLUTIONS, type FrameRate } from '@/types/common'
import type { VideoSettings } from '@/types/settings'

/**
 * One-choice answers to "how heavy should this be": an output size and a frame
 * rate that suit a stronger or a weaker computer.
 */

export type PresetId = 'quality' | 'balanced' | 'performance' | 'light'

export interface Preset {
  id: PresetId
  label: string
  width: number
  height: number
  fps: FrameRate
}

export const PRESETS: readonly Preset[] = [
  { id: 'quality',     label: 'Quality: 1080p, 60 fps',        width: 1920, height: 1080, fps: 60 },
  { id: 'balanced',    label: 'Balanced: 1080p, 30 fps',       width: 1920, height: 1080, fps: 30 },
  { id: 'performance', label: 'Performance: 720p, 30 fps',     width: 1280, height: 720,  fps: 30 },
  { id: 'light',       label: 'Light: 480p, 30 fps',           width: 852,  height: 480,  fps: 30 },
]

/** The preset that matches the current output size and frame rate, or null for a custom mix. */
export function presetOf(video: Pick<VideoSettings, 'outputResolution' | 'fps'>): PresetId | null {
  const { width, height } = video.outputResolution
  return PRESETS.find((p) => p.width === width && p.height === height && p.fps === video.fps)?.id ?? null
}

/** The video settings a preset changes. */
export function presetPatch(id: PresetId): Pick<VideoSettings, 'outputResolution' | 'fps' | 'fpsNumerator' | 'fpsDenominator'> {
  const preset = PRESETS.find((p) => p.id === id) ?? PRESETS[1]
  const resolution = STANDARD_RESOLUTIONS.find((r) => r.width === preset.width && r.height === preset.height)
    ?? { width: preset.width, height: preset.height, label: `${preset.width}×${preset.height}` }
  return { outputResolution: resolution, fps: preset.fps, fpsNumerator: preset.fps, fpsDenominator: 1 }
}
