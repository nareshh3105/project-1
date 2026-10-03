import { useEffect } from 'react'
import { useSceneStore } from '@/stores/sceneStore'
import { useSourceStore } from '@/stores/sourceStore'
import { useCaptureStore } from '@/stores/captureStore'
import { sourcesToResume } from '@/lib/capture/resume'

/** Sources already tried this session, so a failed capture is not retried in a loop. */
const attempted = new Set<string>()

/** Starts the captures of the current scene that know what they point at. */
export function useResumeCaptures() {
  const activeSceneId = useSceneStore((s) => s.activeSceneId)
  const sources = useSourceStore((s) => (activeSceneId ? s.byScene[activeSceneId] : undefined))

  useEffect(() => {
    const { activeIds, startCapture } = useCaptureStore.getState()
    for (const { source, target } of sourcesToResume(sources, activeIds, attempted)) {
      attempted.add(source.id)
      void startCapture(source.id, source.sourceType, target)
    }
  }, [sources])
}

/** For tests: forget what has been tried. */
export function _resetResumeAttempts() {
  attempted.clear()
}
