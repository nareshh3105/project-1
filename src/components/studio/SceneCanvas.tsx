import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Monitor } from 'lucide-react'
import { useSourceStore, type SourceItem } from '@/stores/sourceStore'
import { useCaptureStore, isCaptureType } from '@/stores/captureStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import {
  HANDLES, arrowStep, isArrowKey, moveBy, resizeBy, toCanvas, type Handle, type Placement,
} from '@/lib/canvas/geometry'
import { isStaticType } from '@/lib/sources/static'
import { StaticView } from './StaticView'
import { MediaView } from './MediaView'
import { isMediaType } from '@/lib/sources/media'
import { useFilterStore, type SourceFilter } from '@/stores/filterStore'
import { toSnapshotFilter } from '@/lib/hostSnapshot'
import { planFilters, cropViewBox, type FilterPlan } from '@/lib/filters/plan'
import { setFilterDefs, clearFilterDefs } from '@/lib/filters/defs'

const NO_FILTERS: readonly SourceFilter[] = []

/** The drawing plan for a source's enabled filters. */
function usePlan(sourceId: string): FilterPlan {
  const filters = useFilterStore((s) => s.filtersBySource[sourceId] ?? NO_FILTERS)
  return useMemo(() => planFilters(filters.filter((f) => f.enabled).map(toSnapshotFilter)), [filters])
}
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
 *
 * When interactive, a source can be dragged, resized from its handles and
 * nudged with the arrow keys. The output host draws from the same positions,
 * so what is arranged here is what is recorded.
 */

interface SceneCanvasProps {
  sceneId: string | null
  /** Draws the empty-state hint. Off for thumbnails in the multiview grid. */
  showPlaceholder?: boolean
  /** Renders selection affordances and allows dragging and resizing. */
  interactive?: boolean
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
  className,
}: SceneCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvas = useCanvasFit(containerRef)

  const sources = useSourceStore((s) => (sceneId ? s.byScene[sceneId] ?? [] : []))
  const activeIds = useCaptureStore((s) => s.activeIds)
  const selectedId = useUIStore((s) => s.selectedSourceId)
  const select = useUIStore((s) => s.selectSource)
  const setTransform = useSourceStore((s) => s.setTransform)
  const commitTransform = useSourceStore((s) => s.commitTransform)

  // Painted back to front: orderIndex 0 sits at the bottom of the stack.
  const layers = useMemo(
    () => sources.filter((s) => s.visible).sort((a, b) => a.orderIndex - b.orderIndex),
    [sources],
  )

  // Sharpen and chroma key are SVG filters; the layers refer to them by id, so
  // they must be in the page. Each canvas keeps its own set and removes it on closing.
  const holderId = `cb-defs-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`
  const allFilters = useFilterStore((s) => s.filtersBySource)
  const defs = useMemo(
    () => layers.map((l) => planFilters((allFilters[l.id] ?? NO_FILTERS).filter((f) => f.enabled).map(toSnapshotFilter)).defs).join(''),
    [layers, allFilters],
  )
  useEffect(() => { setFilterDefs(document, defs, holderId) }, [defs, holderId])
  useEffect(() => () => clearFilterDefs(document, holderId), [holderId])

  const anythingLive = layers.some(
    (s) => isCaptureType(s.sourceType) && activeIds.includes(s.id),
  )

  return (
    <div
      ref={containerRef}
      className={cn('relative w-full h-full overflow-hidden bg-black outline-none', className)}
      onPointerDown={interactive ? () => select(null) : undefined}
      // Arrow keys nudge the selected source: one canvas pixel, ten with Shift.
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={interactive ? (e) => {
        const target = layers.find((l) => l.id === selectedId)
        if (!target || target.locked || !sceneId || !isArrowKey(e.key)) return
        e.preventDefault()
        const { dx, dy } = arrowStep(e.key, e.shiftKey)
        setTransform(sceneId, target.id, moveBy(target.transform, dx, dy))
        void commitTransform(sceneId, target.id)
      } : undefined}
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
            scale={canvas.scale}
            onSelect={select}
            onPlace={(patch) => { if (sceneId) setTransform(sceneId, source.id, patch) }}
            onCommit={() => { if (sceneId) void commitTransform(sceneId, source.id) }}
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
  source, live, interactive, selected, scale, onSelect, onPlace, onCommit,
}: {
  source: SourceItem
  live: boolean
  interactive: boolean
  selected: boolean
  /** How much the canvas is shrunk to fit, for turning pointer movement into canvas pixels. */
  scale: number
  onSelect?: (id: string) => void
  onPlace: (patch: Partial<Placement>) => void
  onCommit: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const getStream = useCaptureStore((s) => s.getStream)
  const { x, y, width, height, rotation, scaleX, scaleY } = source.transform
  const editable = interactive && !source.locked
  const plan = usePlan(source.id)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  /** Ends the drag in progress, if any, without saving it. */
  const abandonDrag = useRef<(() => void) | null>(null)

  // A drag must not outlive its layer: the scene switching, or the source being
  // removed, mid-gesture would otherwise leave listeners on the window that
  // later save a position for something no longer there.
  useEffect(() => () => abandonDrag.current?.(), [])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.srcObject = live ? (getStream(source.id) ?? null) : null

    // A crop is a share of the picture, so the picture's size has to be known.
    const measure = () => setNatural(video.videoWidth > 0 ? { w: video.videoWidth, h: video.videoHeight } : null)
    video.addEventListener('loadedmetadata', measure)
    video.addEventListener('resize', measure)
    measure()
    return () => {
      video.removeEventListener('loadedmetadata', measure)
      video.removeEventListener('resize', measure)
    }
  }, [live, source.id, getStream])

  // Colors and text are drawn at the size of their box, so that is their size.
  const knownSize = isCaptureType(source.sourceType) || source.sourceType === 'image' || isMediaType(source.sourceType)
    ? natural
    : { w: Math.round(width), h: Math.round(height) }
  const appearance: React.CSSProperties = {
    filter: plan.css === 'none' ? undefined : plan.css,
    objectViewBox: knownSize ? cropViewBox(plan.crop, knownSize.w, knownSize.h) : undefined,
  } as React.CSSProperties

  const placement: React.CSSProperties = {
    position: 'absolute',
    left: x,
    top: y,
    width,
    height,
    transform: `rotate(${rotation}deg) scale(${scaleX}, ${scaleY})`,
    transformOrigin: 'center',
  }

  /**
   * One drag, from pressing on the source or a handle to letting go. Escape puts
   * the source back where it was. Only the end of the drag is saved: the
   * position is written to the database once, not for every pixel.
   */
  function beginDrag(e: React.PointerEvent, mode: 'move' | Handle) {
    if (!editable || e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    onSelect?.(source.id)

    const start: Placement = { x, y, width, height }
    const originX = e.clientX
    const originY = e.clientY

    const onMove = (ev: PointerEvent) => {
      const dx = toCanvas(ev.clientX - originX, scale)
      const dy = toCanvas(ev.clientY - originY, scale)
      onPlace(mode === 'move'
        ? moveBy(start, dx, dy)
        // Corners keep the proportions unless Shift is held, as in OBS.
        : resizeBy(start, mode, dx, dy, { keepAspect: !ev.shiftKey }))
    }
    const finish = (commit: boolean) => {
      abandonDrag.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('keydown', onKey)
      if (commit) onCommit()
      else onPlace(start)
    }
    const onUp = () => finish(true)
    const onCancel = () => finish(false)
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') finish(false) }

    abandonDrag.current?.()
    abandonDrag.current = onCancel
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onKey)
  }

  // Handles stay the same size on screen however far the canvas is shrunk.
  const handleSize = 10 / (scale > 0 ? scale : 1)

  return (
    <div
      style={placement}
      data-source-id={source.id}
      onPointerDown={editable ? (e) => beginDrag(e, 'move') : undefined}
      className={cn(
        editable && 'cursor-move',
        selected && 'outline outline-2 outline-accent-start',
      )}
    >
      {isCaptureType(source.sourceType) ? (
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          style={appearance}
          className="w-full h-full object-contain pointer-events-none"
        />
      ) : isMediaType(source.sourceType) ? (
        <MediaView settings={source.settings} style={appearance} onNaturalSize={setNatural} />
      ) : isStaticType(source.sourceType) ? (
        <StaticView
          type={source.sourceType} settings={source.settings} width={width} height={height}
          style={appearance} onNaturalSize={source.sourceType === 'image' ? setNatural : undefined}
        />
      ) : (
        <SourcePlaceholder source={source} />
      )}

      {selected && editable && HANDLES.map((h) => (
        <div
          key={h}
          data-handle={h}
          onPointerDown={(e) => beginDrag(e, h)}
          style={handleStyle(h, handleSize)}
          className="bg-accent-start border border-white/80"
        />
      ))}
    </div>
  )
}

/** Where a handle sits on its source, and the cursor that says which way it pulls. */
function handleStyle(h: Handle, size: number): React.CSSProperties {
  const half = size / 2
  const place = (v: 'start' | 'mid' | 'end') =>
    v === 'start' ? -half : v === 'end' ? `calc(100% - ${half}px)` : `calc(50% - ${half}px)`

  const col = h.includes('w') ? 'start' : h.includes('e') ? 'end' : 'mid'
  const row = h.includes('n') ? 'start' : h.includes('s') ? 'end' : 'mid'
  const cursor =
    h === 'n' || h === 's' ? 'ns-resize'
      : h === 'e' || h === 'w' ? 'ew-resize'
        : h === 'nw' || h === 'se' ? 'nwse-resize' : 'nesw-resize'

  return { position: 'absolute', width: size, height: size, left: place(col), top: place(row), cursor }
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
