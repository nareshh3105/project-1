import { useEffect } from 'react'
import { X } from 'lucide-react'
import { useUIStore } from '@/stores/uiStore'
import { useSceneStore } from '@/stores/sceneStore'
import { CaptureVideo } from '@/components/panels/PreviewPanel'

/**
 * Borderless fullscreen view of the program scene.
 * Escape (or the close button) returns to the normal layout.
 */
export function FullscreenPreview() {
  const fullscreenPreview    = useUIStore((s) => s.fullscreenPreview)
  const setFullscreenPreview = useUIStore((s) => s.setFullscreenPreview)
  const activeSceneId        = useSceneStore((s) => s.activeSceneId)

  useEffect(() => {
    if (!fullscreenPreview) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        setFullscreenPreview(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreenPreview, setFullscreenPreview])

  if (!fullscreenPreview) return null

  return (
    <div className="fixed inset-0 z-[90] bg-black flex items-center justify-center animate-fade-in">
      <CaptureVideo sceneId={activeSceneId} />

      <button
        onClick={() => setFullscreenPreview(false)}
        title="Exit fullscreen preview (Esc)"
        className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-button
                   bg-black/50 text-text-secondary hover:text-text-primary hover:bg-black/70
                   transition-colors"
      >
        <X size={16} />
      </button>

      <span className="absolute bottom-4 left-1/2 -translate-x-1/2 text-[10px] text-text-muted opacity-40">
        Press Esc to exit
      </span>
    </div>
  )
}
