import * as Dialog from '@radix-ui/react-dialog'
import { X, Layers } from 'lucide-react'
import { useUIStore } from '@/stores/uiStore'
import { useSceneStore } from '@/stores/sceneStore'
import { useSourceStore } from '@/stores/sourceStore'
import { CaptureVideo } from '@/components/panels/PreviewPanel'
import { cn } from '@/lib/utils'

/**
 * Grid of every scene in the active collection. Clicking a tile makes that
 * scene live (or stages it to preview when Studio Mode is on), mirroring the
 * behaviour of the Scenes panel.
 */
export function MultiviewModal() {
  const { modal, closeModal, studioMode } = useUIStore((s) => ({
    modal:      s.modal,
    closeModal: s.closeModal,
    studioMode: s.studioMode,
  }))

  const { scenes, activeSceneId, previewSceneId, setActiveScene, setPreviewScene } =
    useSceneStore((s) => ({
      scenes:          s.scenes,
      activeSceneId:   s.activeSceneId,
      previewSceneId:  s.previewSceneId,
      setActiveScene:  s.setActiveScene,
      setPreviewScene: s.setPreviewScene,
    }))

  const loadSources = useSourceStore((s) => s.loadSources)
  const open = modal?.type === 'multiview'

  async function handleSelect(sceneId: string) {
    if (studioMode) {
      setPreviewScene(sceneId)
    } else {
      setActiveScene(sceneId)
      await loadSources(sceneId)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && closeModal()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/80 z-50 animate-fade-in" />
        <Dialog.Content
          className={cn(
            'fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2',
            'w-[86vw] h-[80vh] bg-bg-panel border border-bg-divider rounded-panel shadow-modal',
            'flex flex-col animate-fade-in overflow-hidden',
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-bg-divider flex-shrink-0">
            <Dialog.Title className="text-body font-semibold text-text-primary">
              Multiview
              <span className="ml-2 font-normal text-caption text-text-muted">
                {scenes.length} scene{scenes.length === 1 ? '' : 's'}
                {studioMode && ' — click to stage to preview'}
              </span>
            </Dialog.Title>
            <button onClick={closeModal} className="icon-btn w-6 h-6">
              <X size={14} />
            </button>
          </div>

          {/* Grid */}
          <div className="flex-1 overflow-y-auto p-4">
            {scenes.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center gap-2">
                <Layers size={26} className="text-text-muted opacity-20" />
                <p className="text-caption text-text-muted">No scenes in this collection</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                {scenes.map((scene) => {
                  const isProgram = scene.id === activeSceneId
                  const isPreview = studioMode && scene.id === previewSceneId
                  return (
                    <button
                      key={scene.id}
                      onClick={() => handleSelect(scene.id)}
                      className={cn(
                        'group relative aspect-video rounded-button overflow-hidden bg-black',
                        'border-2 transition-colors text-left',
                        isProgram
                          ? 'border-state-danger'
                          : isPreview
                            ? 'border-state-success'
                            : 'border-bg-divider hover:border-accent-start',
                      )}
                    >
                      <CaptureVideo sceneId={scene.id} showPlaceholder={false} />

                      {/* Label bar */}
                      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 px-2 py-1 bg-black/70">
                        <span className="flex-1 text-[11px] text-text-primary truncate">
                          {scene.name}
                        </span>
                        {isProgram && (
                          <span className="text-[9px] font-semibold text-state-danger">LIVE</span>
                        )}
                        {isPreview && (
                          <span className="text-[9px] font-semibold text-state-success">PREVIEW</span>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
