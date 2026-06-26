import { useTransitionStore, type TransitionType } from '@/stores/transitionStore'
import { useSceneStore } from '@/stores/sceneStore'
import { cn } from '@/lib/utils'

const TYPES: { id: TransitionType; label: string }[] = [
  { id: 'cut',   label: 'Cut'   },
  { id: 'fade',  label: 'Fade'  },
  { id: 'slide', label: 'Slide' },
  { id: 'wipe',  label: 'Wipe'  },
]

export function TransitionBar() {
  const { type, durationMs, isTransitioning, setType, setDuration, executeTransition } =
    useTransitionStore()

  const { activeSceneId, previewSceneId, setActiveScene, setPreviewScene } =
    useSceneStore((s) => ({
      activeSceneId:   s.activeSceneId,
      previewSceneId:  s.previewSceneId,
      setActiveScene:  s.setActiveScene,
      setPreviewScene: s.setPreviewScene,
    }))

  const canTransition = !!previewSceneId && previewSceneId !== activeSceneId

  function doTransition() {
    if (!canTransition || isTransitioning) return
    const targetId = previewSceneId!
    const prevId   = activeSceneId
    executeTransition(() => {
      setActiveScene(targetId)
      if (prevId) setPreviewScene(prevId)
    })
  }

  function doCut() {
    if (!canTransition || isTransitioning) return
    const targetId = previewSceneId!
    const prevId   = activeSceneId
    setActiveScene(targetId)
    if (prevId) setPreviewScene(prevId)
  }

  return (
    <div className="flex flex-col items-center gap-2 w-[108px] flex-shrink-0 py-3 px-2 bg-bg-base border-x border-bg-divider">
      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">
        Transition
      </span>

      {/* Type selector */}
      <div className="w-full flex flex-col gap-0.5">
        {TYPES.map((t) => (
          <button
            key={t.id}
            onClick={() => setType(t.id)}
            className={cn(
              'w-full px-2 h-6 rounded text-[11px] text-left transition-colors',
              type === t.id
                ? 'bg-state-active text-accent-start font-semibold'
                : 'text-text-muted hover:text-text-secondary hover:bg-state-hover',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Duration — hidden for Cut */}
      {type !== 'cut' && (
        <div className="w-full">
          <label className="text-[10px] text-text-muted block mb-1 leading-none">
            Duration (ms)
          </label>
          <input
            type="number"
            min={50}
            max={3000}
            step={50}
            value={durationMs}
            onChange={(e) =>
              setDuration(Math.max(50, Math.min(3000, Number(e.target.value))))
            }
            className="w-full h-6 px-1 rounded text-[11px] bg-bg-panel border border-bg-divider text-text-primary text-center focus:outline-none focus:border-accent-start"
          />
        </div>
      )}

      <div className="flex-1" />

      {/* Primary: Transition */}
      <button
        onClick={doTransition}
        disabled={!canTransition || isTransitioning}
        className={cn(
          'w-full h-8 rounded-button text-[11px] font-semibold text-white transition-all',
          'bg-accent-gradient hover:opacity-90',
          'disabled:opacity-40 disabled:cursor-not-allowed',
          isTransitioning && 'animate-pulse',
        )}
      >
        {isTransitioning ? '…' : 'Transition'}
      </button>

      {/* Secondary: Cut */}
      <button
        onClick={doCut}
        disabled={!canTransition || isTransitioning}
        className={cn(
          'w-full h-6 rounded text-[11px] transition-colors',
          'text-text-muted hover:text-text-secondary hover:bg-state-hover',
          'disabled:opacity-40 disabled:cursor-not-allowed',
        )}
      >
        Cut
      </button>
    </div>
  )
}
