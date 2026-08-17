import { registerAppCommands } from './app'
import { registerAudioCommands } from './audio'
import { registerCollectionCommands } from './collections'
import { registerHotkeyCommands } from './hotkeys'
import { registerOutputCommands } from './output'
import { registerPluginCommands } from './plugins'
import { registerSceneCommands } from './scenes'
import { registerScreenshotCommands } from './screenshot'
import { registerSourceCommands } from './sources'
import { registerStatsCommands } from './stats'
import { registerUpdaterCommands } from './updater'
import { registerWindowCommands } from './window'
import { registeredCommands } from '../ipc'

export function registerCommands() {
  registerAppCommands()
  registerAudioCommands()
  registerCollectionCommands()
  registerHotkeyCommands()
  registerOutputCommands()
  registerPluginCommands()
  registerSceneCommands()
  registerScreenshotCommands()
  registerSourceCommands()
  registerStatsCommands()
  registerUpdaterCommands()
  registerWindowCommands()

  console.info(`[ipc] ${registeredCommands().length} commands registered`)
}
