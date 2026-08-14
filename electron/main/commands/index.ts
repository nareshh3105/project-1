import { registerAppCommands } from './app'
import { registerAudioCommands } from './audio'
import { registerCollectionCommands } from './collections'
import { registerOutputCommands } from './output'
import { registerPluginCommands } from './plugins'
import { registerSceneCommands } from './scenes'
import { registerScreenshotCommands } from './screenshot'
import { registerSourceCommands } from './sources'
import { registerStatsCommands } from './stats'
import { registerUpdaterCommands } from './updater'
import { registeredCommands } from '../ipc'

export function registerCommands() {
  registerAppCommands()
  registerAudioCommands()
  registerCollectionCommands()
  registerOutputCommands()
  registerPluginCommands()
  registerSceneCommands()
  registerScreenshotCommands()
  registerSourceCommands()
  registerStatsCommands()
  registerUpdaterCommands()

  console.info(`[ipc] ${registeredCommands().length} commands registered`)
}
