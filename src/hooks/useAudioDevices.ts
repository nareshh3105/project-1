import { useEffect } from 'react'
import { useSettingsStore } from '@/stores/settingsStore'
import { useAudioStore } from '@/stores/audioStore'

/** Settings store "no choice" marker for a device. */
export const SYSTEM_DEFAULT = 'default'

/**
 * Keeps the mixer on the microphone chosen in Settings → Audio.
 *
 * The choice lives in the settings, where it goes through OK and Cancel like
 * every other setting; the mixer and the recorder read it from the audio store.
 */
export function useAudioDevices() {
  const mic = useSettingsStore((s) => s.audio.auxDevice1)

  useEffect(() => {
    useAudioStore.getState().setDevice('mic', !mic || mic === SYSTEM_DEFAULT || mic === 'disabled' ? '' : mic)
  }, [mic])
}
