import { command } from '../ipc'
import { mediaRegistry } from '../media/protocol'

export function registerMediaCommands() {
  /** The address a chosen video or sound file can be played from. */
  command('media_url', ({ filePath }) => mediaRegistry.register(filePath))
}
