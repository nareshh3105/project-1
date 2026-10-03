import { command } from '../ipc'
import { getHost } from '../host/instance'
import { sanitizeSnapshot } from '../host/snapshot'

export function registerHostCommands() {
  /**
   * The interface publishes the scene and mixer state whenever it changes. The
   * host composes and mixes from the latest one; if it is not running yet, it is
   * kept and delivered when it starts.
   */
  command('host_push_state', ({ snapshot }) => {
    getHost().setSnapshot(sanitizeSnapshot(snapshot))
  })
}
