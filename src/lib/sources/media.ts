import type { SourceType } from '@/types'

/**
 * The media source: a video or sound file played in the scene.
 *
 * Settings are read defensively, as they come from the database. The sound of the
 * file is mixed into what is recorded at the volume set here; the file is played
 * silently in the preview so it does not sound twice.
 */

export const isMediaType = (type: SourceType | string): boolean => type === 'media_source'

export interface MediaSettings {
  filePath: string
  /** Start again at the end. */
  loop: boolean
  /** Level of the sound in the mix, 0 to 1. */
  volume: number
  muted: boolean
}

export const DEFAULT_MEDIA: MediaSettings = { filePath: '', loop: true, volume: 1, muted: false }

/** Where a new media source is placed before a file is chosen, in canvas pixels. */
export const DEFAULT_MEDIA_PLACEMENT = { x: 0, y: 0, width: 1280, height: 720 }

export const MEDIA_FILE_FILTER = [
  { name: 'Video and sound', extensions: ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'ogv', 'mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus'] },
]

export function parseMedia(settings: Record<string, unknown> | undefined): MediaSettings {
  const s = settings ?? {}
  const volume = typeof s.volume === 'number' && Number.isFinite(s.volume) ? Math.min(1, Math.max(0, s.volume)) : 1
  return {
    filePath: typeof s.filePath === 'string' ? s.filePath.slice(0, 1024) : '',
    loop: s.loop === false ? false : true,
    volume,
    muted: s.muted === true,
  }
}

/** The level the file's sound is mixed at: silent when muted. */
export const mediaGain = (m: MediaSettings): number => (m.muted ? 0 : m.volume)

/** The file name alone, for showing where a full path would be long. */
export function fileNameOf(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath
}

/** What the player reports when it cannot play a file, put in terms of what to do. */
export function playbackProblem(code: number | undefined): string {
  switch (code) {
    case 3: return 'This file is damaged or cannot be decoded. Try an MP4 or WebM file.'
    case 4: return 'This kind of file cannot be played by the app. Try an MP4 (H.264), WebM or MOV file.'
    case 2: return 'The file could not be read.'
    default: return 'The file could not be played.'
  }
}
