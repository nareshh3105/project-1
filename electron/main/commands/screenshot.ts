import { desktopCapturer, screen } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { command } from '../ipc'
import { ensureParentDir, timestamp, uniquePath } from '../output/ffmpeg'

export function registerScreenshotCommands() {
  command('take_screenshot', async ({ outputPath }) => {
    // Request at the display's real resolution; the default thumbnail size is
    // a fraction of it and would save a blurry image.
    const { width, height } = screen.getPrimaryDisplay().size
    const scale = screen.getPrimaryDisplay().scaleFactor || 1

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: Math.round(width * scale),
        height: Math.round(height * scale),
      },
    })

    if (sources.length === 0) throw new Error('No screen available to capture')

    const image = sources[0].thumbnail
    if (image.isEmpty()) throw new Error('Screen capture returned an empty image')

    const dest =
      (outputPath as string) ||
      uniquePath(path.join(os.homedir(), 'Pictures', `Screenshot_${timestamp()}.png`))

    ensureParentDir(dest)
    fs.writeFileSync(dest, image.toPNG())
    return dest
  })
}
