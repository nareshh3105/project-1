import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Monitor } from 'lucide-react'
import { useSourceStore, type SourceItem } from '@/stores/sourceStore'
import { useCaptureStore, isCaptureType } from '@/stores/captureStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { cn } from '@/lib/utils'

/**
 * Composites every visible source in a scene.
 *
 * The preview previously drew only the topmost capture source, so a scene with
 * a screen share and a webcam showed one of them. Sources are laid out on a
 * fixed canvas (the base resolution from settings) and the whole canvas is
 * scaled to fit whatever space the panel has, which keeps placement resolution
 * independent — a source positioned on a 1920×1080 canvas lands in the same
 * relative spot in a small dock panel and in fullscreen.
 */

interface SceneCanvasProps {
  sceneId: string | null
  /** Draws the empty-state hint. Off for thumbnails in the multiview grid. */
  showPlaceholder?: boolean
  /** Renders selection affordances and allows dragging. */
  interactive?: boolean
  selectedId?: string | null
  onSelect?: (id: string | null) => void
  className?: string
}

/** Canvas size and the factor needed to fit it into the measured container. */
function useCanvasFit(ref: React.RefObject<HTMLDivElement>) {
  const base = useSettingsStore((s) => s.video.baseResolution)
  const [scale, setScale] = useState(1)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return

    const fit = () => {
      const { width, height } = el.getBoundingClientRect()
      if (width === 0 || height === 0) return
      setScale(Math.min(width / base.width, height / base.height))
    }

    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, base.width, base.height])

  return { width: base.width, height: base.height, scale }
}

export function SceneCanvas({
  sceneId,
  showPlaceholder = true,
  interactive = false,
  selectedId = null,
  onSelect,
  className,
}: SceneCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvas = useCanvasFit(containerRef)

  const sources = useSourceStore((s) => (sceneId ? s.byScene[sceneId] ?? [] : []))
  const activeIds = useCaptureStore((s) => s.activeIds)

  // Painted back to front: orderIndex 0 sits at the bottom of the stack.
  const layers = useMemo(
    () => sources.filter((s) => s.visible).sort((a, b) => a.orderIndex - b.orderIndex),
    [sources],
  )

  const anythingLive = layers.some(
    (s) => isCaptureType(s.sourceType) && activeIds.includes(s.id),
  )

  return (
    <div
      ref={containerRef}
      className={cn('relative w-full h-full overflow-hidden bg-black', className)}
      onPointerDown={interactive ? () => onSelect?.(null) : undefined}
    >
      {/* The canvas keeps its own coordinate space; only this wrapper scales. */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: canvas.width,
          height: canvas.height,
          transform: `translate(-50%, -50%) scale(${canvas.scale})`,
          transformOrigin: 'center',
        }}
      >
        {layers.map((source) => (
          <SourceLayer
            key={source.id}
            source={source}
            live={activeIds.includes(source.id)}
            interactive={interactive}
            selected={selectedId === source.id}
            onSelect={onSelect}
          />
        ))}
      </div>

      {!anythingLive && showPlaceholder && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <Monitor size={28} className="text-text-muted opacity-20 mb-1.5" />
          <span className="text-caption text-text-secondary">No active capture</span>
          <span className="text-[10px] text-text-muted mt-0.5">
            Add a Display Capture or Window Capture source
          </span>
        </div>
      )}
    </div>
  )
}

// ── One layer ──────────────────────────────────────────────────────────────

function SourceLayer({
  source, live, interactive, selected, onSelect,
}: {
  source: SourceItem
  live: boolean
  interactive: boolean
  selected: boolean
  onSelect?: (id: string) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const getStream = useCaptureStore((s) => s.getStream)
  const { x, y, width, height, rotation, scaleX, scaleY } = source.transform

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.srcObject = live ? (getStream(source.id) ?? null) : null
  }, [live, source.id, getStream])

  const placement: React.CSSProperties = {
    position: 'absolute',
    left: x,
    top: y,
    width,
    height,
    transform: `rotate(${rotation}deg) scale(${scaleX}, ${scaleY})`,
    transformOrigin: 'center',
  }

  return (
    <div
      style={placement}
      onPointerDown={
        interactive && !source.locked
          ? (e) => { e.stopPropagation(); onSelect?.(source.id) }
          : undefined
      }
      className={cn(
        interactive && !source.locked && 'cursor-move',
        selected && 'outline outline-2 outline-accent-start',
      )}
    >
      {isCaptureType(source.sourceType) ? (
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="w-full h-full object-contain pointer-events-none"
        />
      ) : (
        <SourcePlaceholder source={source} />
      )}
    </div>
  )
}

/**
 * Image and text sources are not rendered yet; showing their footprint is
 * more honest than drawing nothing, since the source exists in the scene.
 */
function SourcePlaceholder({ source }: { source: SourceItem }) {
  return (
    <div className="w-full h-full flex items-center justify-center border border-dashed border-bg-divider/60">
      <span className="text-text-muted opacity-40" style={{ fontSize: 28 }}>
        {source.name}
      </span>
    </div>
  )
}
