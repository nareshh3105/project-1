import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

/**
 * The files the media source may play.
 *
 * A page cannot be handed a plain file path to play: the interface is served
 * from a dev server in development, and the output host must read the video
 * into a canvas, which needs the file to come from a source that allows it. So
 * the main process serves the files through its own address scheme, and only
 * files the user has picked, by an id made up on the spot. A page that asks for
 * anything else gets nothing, so this cannot be used to read other files.
 */

export const SCHEME = 'cbmedia'

/** Containers the app will serve. Whether one plays depends on what is inside it. */
export const MEDIA_EXTENSIONS = [
  'mp4', 'm4v', 'mov', 'webm', 'mkv', 'ogv',
  'mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus',
] as const

export const isMediaPath = (file: string): boolean => {
  const dot = file.lastIndexOf('.')
  if (dot < 1) return false
  return (MEDIA_EXTENSIONS as readonly string[]).includes(file.slice(dot + 1).toLowerCase())
}

export class MediaRegistry {
  private readonly byId = new Map<string, string>()
  private readonly byPath = new Map<string, string>()

  /** Makes a file playable and returns the address to play it from. */
  register(file: unknown): string {
    if (typeof file !== 'string' || file.length === 0) throw new Error('No file was chosen.')
    if (!isMediaPath(file)) {
      throw new Error('That is not a video or sound file the app can play. Use MP4, WebM, MOV, MP3, WAV, OGG or FLAC.')
    }

    const full = path.resolve(file)
    let stat: fs.Stats
    try {
      stat = fs.statSync(full)
    } catch {
      throw new Error('The file could not be found. It may have been moved or deleted.')
    }
    if (!stat.isFile()) throw new Error('That is not a file.')

    let id = this.byPath.get(full)
    if (!id) {
      id = randomUUID()
      this.byPath.set(full, id)
      this.byId.set(id, full)
    }
    return `${SCHEME}://media/${id}`
  }

  /** The file behind an address, or null if it was never registered. */
  resolve(url: string): string | null {
    let id: string
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== `${SCHEME}:` || parsed.hostname !== 'media') return null
      id = parsed.pathname.replace(/^\/+/, '')
    } catch {
      return null
    }
    return this.byId.get(id) ?? null
  }
}
