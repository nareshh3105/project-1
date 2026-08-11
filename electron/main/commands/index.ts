import { registerAppCommands } from './app'
import { registerCollectionCommands } from './collections'
import { registerSceneCommands } from './scenes'
import { registerSourceCommands } from './sources'
import { registeredCommands } from '../ipc'

export function registerCommands() {
  registerAppCommands()
  registerCollectionCommands()
  registerSceneCommands()
  registerSourceCommands()

  console.info(`[ipc] ${registeredCommands().length} commands registered`)
}
