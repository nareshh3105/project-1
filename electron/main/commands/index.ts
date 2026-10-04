import { registerAppCommands } from './app'
import { registerAudioCommands } from './audio'
import { registerCaptureCommands } from './capture'
import { registerCollectionCommands } from './collections'
import { registerHostCommands } from './host'
import { registerHotkeyCommands } from './hotkeys'
import { registerImageCommands } from './images'
import { registerMediaCommands } from './media'
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
  registerCaptureCommands()
  registerCollectionCommands()
  registerHostCommands()
  registerHotkeyCommands()
  registerImageCommands()
  registerMediaCommands()
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
