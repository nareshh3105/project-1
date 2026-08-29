import { globalShortcut } from 'electron'
import { command, emit } from '../ipc'

export const HOTKEY_PRESSED_EVENT = 'hotkey:pressed'

interface Shortcut {
  accelerator: string
  action: string
}

export function registerHotkeyCommands() {
  /**
   * Replaces the entire set of OS-level shortcuts.
   *
   * Registration is all-or-nothing per accelerator: another application may
   * already own a combination, in which case Electron refuses it. Rather than
   * failing the whole sync, the rejected accelerators are returned so the
   * interface can tell the user which bindings did not take effect.
   */
  command('register_shortcuts', ({ shortcuts }) => {
    globalShortcut.unregisterAll()

    const failed: string[] = []
    for (const { accelerator, action } of (shortcuts as Shortcut[]) ?? []) {
      if (!accelerator || !action) continue
      try {
        const ok = globalShortcut.register(accelerator, () => {
          emit(HOTKEY_PRESSED_EVENT, { action })
        })
        if (!ok) failed.push(accelerator)
      } catch {
        // An accelerator the interface built from an unusual key can be
        // syntactically invalid; treat it as a rejection rather than a crash.
        failed.push(accelerator)
      }
    }
    return failed
  })

  command('unregister_shortcuts', () => {
    globalShortcut.unregisterAll()
  })
}

export function unregisterAllShortcuts() {
  globalShortcut.unregisterAll()
}
