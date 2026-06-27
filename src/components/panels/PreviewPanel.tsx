import { useRef, useEffect, useMemo } from 'react'
import { Monitor, Eye } from 'lucide-react'
import { useUIStore }        from '@/stores/uiStore'
import { useSceneStore, type SceneItem } from '@/stores/sceneStore'
import { useSourceStore }    from '@/stores/sourceStore'
import { useTransitionStore } from '@/stores/transitionStore'
import { useCaptureStore, isCaptureType } from '@/stores/captureStore'
import { TransitionBar }     from '@/components/studio/TransitionBar'
import { cn }                from '@/lib/utils'

export function PreviewPanel() {
  const studioMode = useUIStore((s) => s.studioMode)
  return studioMode ? <StudioLayout /> : <NormalPreview />
}

// ── Shared capture video layer ─────────────────────────────────────────────
// Finds the topmost visible capture source in the given scene and renders it
// in a <video> element. Falls back to a placeholder when no stream is active.

interface CaptureVideoProps {
  sceneId:         string | null
  showPlaceholder?: boolean
  className?:       string
}

function CaptureVideo({ sceneId, showPlaceholder = true, className }: CaptureVideoProps) {
  const videoRef  = useRef<HTMLVideoElement>(null)
  const sources   = useSourceStore((s) => sceneId ? (s.byScene[sceneId] ?? []) : [])
  const activeIds = useCaptureStore((s) => s.activeIds)
  const getStream = useCaptureStore((s) => s.getStream)

  // Topmost (highest orderIndex) visible capture source that has an active stream
  const captureSourceId = useMemo(() => {
    return sources
      .filter((s) => s.visible && activeIds.includes(s.id) && isCaptureType(s.sourceType))
      .sort((a, b) => b.orderIndex - a.orderIndex)[0]?.id ?? null
  }, [sources, activeIds])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.srcObject = captureSourceId ? (getStream(captureSourceId) ?? null) : null
  }, [captureSourceId, getStream])

  return (
    <>
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className={cn('w-full h-full object-contain', className)}
      />
      {!captureSourceId && showPlaceholder && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <Monitor size={28} className="text-text-muted opacity-20 mb-1.5" />
          <span className="text-caption text-text-muted opacity-25">No active capture</span>
          <span className="text-[10px] text-text-muted opacity-15 mt-0.5">
            Add a Display Capture or Window Capture source
          </span>
        </div>
      )}
    </>
  )
}

// ── Normal (non-studio) preview ────────────────────────────────────────────

function NormalPreview() {
  const activeSceneId = useSceneStore((s) => s.activeSceneId)
  return (
    <div className="flex flex-col h-full bg-black overflow-hidden relative">
      <CaptureVideo sceneId={activeSceneId} />
    </div>
  )
}

// ── Studio Mode ────────────────────────────────────────────────────────────

function StudioLayout() {
  const { scenes, previewSceneId, activeSceneId } = useSceneStore((s) => ({
    scenes:          s.scenes,
    previewSceneId:  s.previewSceneId,
    activeSceneId:   s.activeSceneId,
  }))

  const previewScene = scenes.find((s) => s.id === previewSceneId) ?? null
  const programScene = scenes.find((s) => s.id === activeSceneId)  ?? null

  return (
    <div className="flex h-full overflow-hidden">
      {/* PREVIEW pane */}
      <div className="flex-1 flex flex-col min-w-0">
        <PaneLabel label="PREVIEW" variant="preview" />
        <StageCard scene={previewScene} />
      </div>

      {/* Center transition bar */}
      <TransitionBar />

      {/* PROGRAM pane */}
      <div className="flex-1 flex flex-col min-w-0">
        <PaneLabel label="PROGRAM" variant="program" />
        <ProgramCanvas scene={programScene} />
      </div>
    </div>
  )
}

function PaneLabel({ label, variant }: { label: string; variant: 'preview' | 'program' }) {
  return (
    <div className={cn(
      'h-6 flex items-center justify-center flex-shrink-0',
      'text-[10px] font-bold tracking-[0.15em] border-b',
      variant === 'preview'
        ? 'text-accent-start bg-state-active border-accent-start/25'
        : 'text-state-danger bg-state-danger/10 border-state-danger/25',
    )}>
      {label}
    </div>
  )
}

// ── Staged scene preview card ──────────────────────────────────────────────

function StageCard({ scene }: { scene: SceneItem | null }) {
  return (
    <div className="flex-1 relative bg-black overflow-hidden">
      <div className="absolute inset-0 border border-accent-start/15 pointer-events-none z-10" />

      {scene ? (
        <>
          <CaptureVideo sceneId={scene.id} showPlaceholder={false} />

          {/* Scene name overlay */}
          <div className="absolute bottom-2 left-2 z-10 flex items-center gap-1 pointer-events-none">
            <Eye size={10} className="text-accent-start opacity-50" />
            <span className="text-[10px] text-text-secondary opacity-60">{scene.name}</span>
          </div>

          <div className="absolute inset-3 border border-dashed border-accent-start/10 pointer-events-none rounded-sm z-10" />
        </>
      ) : (
        <div className="flex flex-col items-center justify-center h-full gap-1.5 px-4 text-center">
          <Eye size={18} className="text-text-muted opacity-20" />
          <span className="text-caption text-text-muted opacity-30">No scene staged</span>
          <span className="text-[10px] text-text-muted opacity-20 mt-0.5">
            Click a scene in the panel
          </span>
        </div>
      )}
    </div>
  )
}

// ── Live program canvas ────────────────────────────────────────────────────

function ProgramCanvas({ scene }: { scene: SceneItem | null }) {
  const { isTransitioning, type, durationMs } = useTransitionStore((s) => ({
    isTransitioning: s.isTransitioning,
    type:            s.type,
    durationMs:      s.durationMs,
  }))

  const animStyle: React.CSSProperties =
    isTransitioning && type !== 'cut'
      ? {
          animationName:           `program-${type}`,
          animationDuration:       `${durationMs}ms`,
          animationTimingFunction: 'ease-in-out',
          animationFillMode:       'both',
        }
      : {}

  return (
    <div className="flex-1 relative bg-black overflow-hidden" style={animStyle}>
      {/* Live red border */}
      <div className="absolute inset-0 border border-state-danger/25 pointer-events-none z-10" />

      <CaptureVideo sceneId={scene?.id ?? null} />

      {/* LIVE badge */}
      <div className="absolute top-2 right-2 z-20 flex items-center gap-1 bg-state-danger px-2 py-0.5 rounded text-[10px] text-white font-bold">
        <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
        LIVE
      </div>

      {!scene && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-10">
          <Monitor size={24} className="text-state-danger opacity-20 mb-1" />
          <span className="text-caption text-state-danger opacity-30">Program</span>
        </div>
      )}
    </div>
  )
}
