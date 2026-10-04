import fs from 'node:fs/promises'
import path from 'node:path'
import { command } from '../ipc'

/**
 * Reads an image the user picked, for the image source.
 *
 * The interface cannot open files itself, and a page loaded from the dev server
 * cannot load file:// URLs, so the main process reads the file and hands back a
 * data URL. Only image files up to a size limit are served, so this cannot be
 * used to read arbitrary files out of the machine.
 */

export const MAX_IMAGE_BYTES = 30 * 1024 * 1024

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
}

export async function readImageAsDataUrl(file: unknown): Promise<string> {
  if (typeof file !== 'string' || file.length === 0) throw new Error('No image was chosen.')

  const ext = path.extname(file).slice(1).toLowerCase()
  const mime = MIME[ext]
  if (!mime) throw new Error('That is not a picture the app can show. Use PNG, JPG, GIF, WebP or BMP.')

  let stat
  try {
    stat = await fs.stat(file)
  } catch {
    throw new Error('The picture could not be found. It may have been moved or deleted.')
  }
  if (!stat.isFile()) throw new Error('That is not a file.')
  if (stat.size > MAX_IMAGE_BYTES) {
    throw new Error(`The picture is too large (${Math.round(stat.size / 1048576)} MB). The limit is ${MAX_IMAGE_BYTES / 1048576} MB.`)
  }

  const data = await fs.readFile(file)
  return `data:${mime};base64,${data.toString('base64')}`
}

export function registerImageCommands() {
  command('read_image_file', ({ path: file }) => readImageAsDataUrl(file))
}
