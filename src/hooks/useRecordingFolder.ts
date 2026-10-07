import { useEffect } from 'react'
import { ipc } from '@/ipc'
import { useSettingsStore } from '@/stores/settingsStore'
import { useNotifyStore, describeError } from '@/stores/notifyStore'

/**
 * Tells the main process which folder recordings go to: once at startup, and
 * again whenever the choice in Settings changes.
 *
 * A folder that cannot be used (a drive that is gone, no permission) is said so
 * as soon as it is chosen, and recordings go to the default folder meanwhile.
 */
export function useRecordingFolder() {
  useEffect(() => {
    let last: string | null = null

    const send = (folder: string) => {
      if (folder === last) return
      last = folder
      ipc.output.setFolder(folder).catch((err) => {
        // Not usable: fall back to the default rather than record somewhere unexpected.
        void ipc.output.setFolder('').catch(() => {})
        useNotifyStore.getState().notify(
          'error',
          `${describeError(err)} Recordings will go to the Videos folder until you choose another.`,
        )
      })
    }

    send(useSettingsStore.getState().recording.outputFolder ?? '')
    return useSettingsStore.subscribe((s) => send(s.recording.outputFolder ?? ''))
  }, [])
}
