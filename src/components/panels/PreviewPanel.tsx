import { useRef, useEffect, useState } from 'react'
import { Monitor, Eye } from 'lucide-react'
import { ipc, onPreviewFrame } from '@/ipc'
import { useUIStore } from '@/stores/uiStore'
import { useSceneStore, type SceneItem } from '@/stores/sceneStore'
import { useTransitionStore } from '@/stores/transitionStore'
import { TransitionBar } from '@/components/studio/TransitionBar'
import { cn } from '@/lib/utils'

export function PreviewPanel() {
  const studioMode = useUIStore((s) => s.studioMode)
  return studioMode ? <StudioLayout /> : <NormalPreview />
}

// ── Normal (non-studio) preview ───────────────────────────────────────────────

function NormalPreview() {
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const hasFramesRef = useRef(false)
  const [hasFrames, setHasFrames] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const drawGuides = () => {
      if (hasFramesRef.current) return
      const { width, height } = canvas.getBoundingClientRect()
      if (!width || !height) return
      canvas.width  = width  * devicePixelRatio
      canvas.height = height * devicePixelRatio
      const ctx = canvas.getContext('2d')!
      ctx.scale(devicePixelRatio, devicePixelRatio)
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, width, height)
      const sw = width * 0.9, sh = height * 0.9
      const sx = (width - sw) / 2, sy = (height - sh) / 2
      ctx.strokeStyle = 'rgba(138,92,255,0.25)'
      ctx.lineWidth   = 1
      ctx.setLineDash([4, 4])
      ctx.strokeRect(sx, sy, sw, sh)
      ctx.setLineDash([])
      ctx.strokeStyle = 'rgba(138,92,255,0.4)'
      ctx.beginPath()
      ctx.moveTo(width / 2 - 10, height / 2)
      ctx.lineTo(width / 2 + 10, height / 2)
      ctx.moveTo(width / 2, height / 2 - 10)
      ctx.lineTo(width / 2, height / 2 + 10)
      ctx.stroke()
    }
    drawGuides()
    const ro = new ResizeObserver(drawGuides)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    let unlisten: (() => void) | null = null
    async function setup() {
      try { await ipc.preview.start() } catch { return }
      unlisten = await onPreviewFrame((dataUrl) => {
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        const img = new Image()
        img.onload = () => {
          const { width, height } = canvas.getBoundingClientRect()
          if (!width || !height) return
          const dpr = devicePixelRatio
          if (
            canvas.width  !== Math.round(width  * dpr) ||
            canvas.height !== Math.round(height * dpr)
          ) {
            canvas.width  = Math.round(width  * dpr)
            canvas.height = Math.round(height * dpr)
          }
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
          if (!hasFramesRef.current) { hasFramesRef.current = true; setHasFrames(true) }
        }
        img.src = dataUrl
      })
    }
    setup()
    return () => { unlisten?.(); ipc.preview.stop().catch(() => {}) }
  }, [])

  return (
    <div className="flex flex-col h-full bg-black overflow-hidden relative">
      <canvas ref={canvasRef} className="w-full h-full" style={{ display: 'block' }} />
      {!hasFrames && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <Monitor size={32} className="text-text-muted opacity-20 mb-2" />
          <span className="text-caption text-text-muted opacity-30">Preview</span>
          <span className="text-caption text-text-muted opacity-20 text-xs mt-1">
            Starting capture…
          </span>
        </div>
      )}
    </div>
  )
}

// ── Studio Mode ───────────────────────────────────────────────────────────────

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

// ── Staged scene preview card ─────────────────────────────────────────────────

function StageCard({ scene }: { scene: SceneItem | null }) {
  return (
    <div className="flex-1 relative bg-black flex flex-col items-center justify-center overflow-hidden">
      {/* Subtle border */}
      <div className="absolute inset-0 border border-accent-start/15 pointer-events-none" />
      <div className="absolute inset-4 border border-dashed border-accent-start/10 pointer-events-none rounded-sm" />

      {scene ? (
        <div className="flex flex-col items-center gap-1.5 px-4 text-center">
          <Eye size={18} className="text-accent-start opacity-50" />
          <span className="text-caption text-text-secondary font-medium">{scene.name}</span>
          <span className="text-[10px] text-text-muted opacity-50">Ready to transition</span>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-1.5 px-4 text-center">
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

// ── Live program canvas ───────────────────────────────────────────────────────

function ProgramCanvas({ scene }: { scene: SceneItem | null }) {
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const hasFramesRef = useRef(false)
  const [hasFrames, setHasFrames] = useState(false)

  const { isTransitioning, type, durationMs } = useTransitionStore((s) => ({
    isTransitioning: s.isTransitioning,
    type:            s.type,
    durationMs:      s.durationMs,
  }))

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const fill = () => {
      if (hasFramesRef.current) return
      const { width, height } = canvas.getBoundingClientRect()
      if (!width || !height) return
      canvas.width  = Math.round(width  * devicePixelRatio)
      canvas.height = Math.round(height * devicePixelRatio)
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }
    fill()
    const ro = new ResizeObserver(fill)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    let unlisten: (() => void) | null = null
    async function setup() {
      try { await ipc.preview.start() } catch { return }
      unlisten = await onPreviewFrame((dataUrl) => {
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        const img = new Image()
        img.onload = () => {
          const { width, height } = canvas.getBoundingClientRect()
          if (!width || !height) return
          const dpr = devicePixelRatio
          if (
            canvas.width  !== Math.round(width  * dpr) ||
            canvas.height !== Math.round(height * dpr)
          ) {
            canvas.width  = Math.round(width  * dpr)
            canvas.height = Math.round(height * dpr)
          }
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
          if (!hasFramesRef.current) { hasFramesRef.current = true; setHasFrames(true) }
        }
        img.src = dataUrl
      })
    }
    setup()
    return () => { unlisten?.(); ipc.preview.stop().catch(() => {}) }
  }, [])

  // Apply transition animation via inline style (duration is dynamic)
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

      <canvas
        ref={canvasRef}
        className="w-full h-full"
        style={{ display: 'block' }}
      />

      {/* LIVE badge */}
      <div className="absolute top-2 right-2 z-20 flex items-center gap-1 bg-state-danger px-2 py-0.5 rounded text-[10px] text-white font-bold">
        <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
        LIVE
      </div>

      {!hasFrames && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-10">
          <Monitor size={24} className="text-state-danger opacity-20 mb-1" />
          <span className="text-caption text-state-danger opacity-30">
            {scene?.name ?? 'Program'}
          </span>
        </div>
      )}
    </div>
  )
}
