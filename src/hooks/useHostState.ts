import { useEffect } from 'react'
import { ipc } from '@/ipc'
import { buildSnapshot } from '@/lib/hostSnapshot'
import { useSceneStore } from '@/stores/sceneStore'
import { useSourceStore } from '@/stores/sourceStore'
import { useAudioStore } from '@/stores/audioStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useFilterStore } from '@/stores/filterStore'
import { useTransitionStore } from '@/stores/transitionStore'
import { reportFailure } from '@/stores/notifyStore'

/** Longest the host may be left with a stale scene while the user is dragging. */
const PUBLISH_EVERY_MS = 40

/**
 * Keeps the output host informed of the scene and mixer, so what is recorded
 * follows what the user arranges.
 *
 * State changes many times a second during a drag, so publishing is coalesced,
 * and a snapshot identical to the last one is not sent again (the audio meters
 * update the store constantly without changing anything the host cares about).
 */
export function useHostState() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let last = ''
    let warned = false

    const publish = () => {
      timer = null
      const { activeSceneId } = useSceneStore.getState()
      const sources = activeSceneId ? useSourceStore.getState().byScene[activeSceneId] ?? [] : []
      const { channels, connected, devices } = useAudioStore.getState()
      const base = useSettingsStore.getState().video.baseResolution

      // A transition counts only while the scene it brings in is the one on air;
      // a scene clicked in the meantime has overtaken it.
      const moving = useTransitionStore.getState().active
      const transition = moving && moving.fromSceneId && moving.toSceneId === activeSceneId
        ? {
            type: moving.type, durationMs: moving.durationMs, startedAt: moving.startedAt,
            from: useSourceStore.getState().byScene[moving.fromSceneId] ?? [],
          }
        : undefined

      const snapshot = buildSnapshot({
        sources, base, channels, connected, devices, transition,
        filters: useFilterStore.getState().filtersBySource,
      })
      const key = JSON.stringify(snapshot)
      if (key === last) return
      last = key

      ipc.host.pushState(snapshot).catch((err) => {
        last = '' // try again on the next change
        if (!warned) {
          warned = true
          reportFailure('update the recording engine', err)
        }
      })
    }

    const schedule = () => {
      if (timer === null) timer = setTimeout(publish, PUBLISH_EVERY_MS)
    }

    const unsubscribe = [
      useSceneStore.subscribe(schedule),
      useSourceStore.subscribe(schedule),
      useAudioStore.subscribe(schedule),
      useSettingsStore.subscribe(schedule),
      useFilterStore.subscribe(schedule),
      useTransitionStore.subscribe(schedule),
    ]
    schedule()

    return () => {
      unsubscribe.forEach((u) => u())
      if (timer !== null) clearTimeout(timer)
    }
  }, [])
}
