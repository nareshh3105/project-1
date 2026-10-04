import { useState } from 'react'
import { Plus, Copy, Trash2, Edit2 } from 'lucide-react'
import * as ContextMenu from '@radix-ui/react-context-menu'
import { useSceneStore, nextSceneName, type SceneItem } from '@/stores/sceneStore'
import { useSourceStore } from '@/stores/sourceStore'
import { useUIStore } from '@/stores/uiStore'
import { useTransitionStore, type TransitionType } from '@/stores/transitionStore'
import { RenameModal } from '@/components/modals/RenameModal'
import { ConfirmModal } from '@/components/modals/ConfirmModal'
import { cn } from '@/lib/utils'

export function ScenesPanel() {
  const {
    scenes, activeSceneId, previewSceneId,
    setActiveScene, setPreviewScene,
    createScene, deleteScene, duplicateScene,
  } = useSceneStore((s) => ({
    scenes:          s.scenes,
    activeSceneId:   s.activeSceneId,
    previewSceneId:  s.previewSceneId,
    setActiveScene:  s.setActiveScene,
    setPreviewScene: s.setPreviewScene,
    createScene:     s.createScene,
    deleteScene:     s.deleteScene,
    duplicateScene:  s.duplicateScene,
  }))

  const loadSources = useSourceStore((s) => s.loadSources)
  const studioMode  = useUIStore((s) => s.studioMode)

  const [renameTarget, setRenameTarget] = useState<SceneItem | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<SceneItem | null>(null)

  async function handleSelectScene(scene: SceneItem) {
    if (studioMode) {
      // In Studio Mode, clicking stages to PREVIEW (not program)
      setPreviewScene(scene.id)
    } else {
      if (scene.id === useSceneStore.getState().activeSceneId) return
      // Its sources must be there before it comes in, or the transition would bring in an empty scene.
      await loadSources(scene.id)

      const { isTransitioning, executeTransition } = useTransitionStore.getState()
      const from = useSceneStore.getState().activeSceneId
      if (isTransitioning) setActiveScene(scene.id) // a click during a change takes effect at once
      else executeTransition({ fromSceneId: from, toSceneId: scene.id }, () => setActiveScene(scene.id))
    }
  }

  async function handleAddScene() {
    await createScene(nextSceneName(scenes.map((s) => s.name)))
  }

  return (
    <div className="flex flex-col h-full bg-bg-surface overflow-hidden">
      {/* Header */}
      <div className="panel-header">
        <span className="panel-header-title">Scenes</span>
        <button className="icon-btn" title="Add scene" onClick={handleAddScene}>
          <Plus size={12} />
        </button>
      </div>

      {/* Scene list */}
      <div className="flex-1 overflow-y-auto">
        {scenes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 px-4">
            <p className="text-caption text-text-muted">No scenes yet</p>
            <button
              onClick={handleAddScene}
              className="text-caption text-accent-start hover:underline"
            >
              Add your first scene
            </button>
          </div>
        ) : (
          scenes.map((scene) => (
            <SceneRow
              key={scene.id}
              scene={scene}
              isProgram={scene.id === activeSceneId}
              isPreview={studioMode && scene.id === previewSceneId}
              studioMode={studioMode}
              onSelect={() => handleSelectScene(scene)}
              onRename={() => setRenameTarget(scene)}
              onDuplicate={() => duplicateScene(scene.id)}
              onDelete={() => setDeleteTarget(scene)}
            />
          ))
        )}
      </div>

      {/* Bottom toolbar */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-t border-bg-divider">
        <button className="icon-btn" title="Add scene" onClick={handleAddScene}>
          <Plus size={12} />
        </button>
        <TransitionChoice />
      </div>

      {/* Modals */}
      <RenameModal
        open={!!renameTarget}
        title="Rename Scene"
        current={renameTarget?.name ?? ''}
        onConfirm={(name) => renameTarget && useSceneStore.getState().renameScene(renameTarget.id, name)}
        onClose={() => setRenameTarget(null)}
      />
      <ConfirmModal
        open={!!deleteTarget}
        title="Delete Scene"
        message={`Delete "${deleteTarget?.name ?? ''}"? This cannot be undone.`}
        confirmLabel="Delete"
        danger
        onConfirm={() => deleteTarget && deleteScene(deleteTarget.id)}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  )
}

interface SceneRowProps {
  scene:       SceneItem
  isProgram:   boolean
  isPreview:   boolean
  studioMode:  boolean
  onSelect:    () => void
  onRename:    () => void
  onDuplicate: () => void
  onDelete:    () => void
}

function SceneRow({
  scene, isProgram, isPreview, studioMode,
  onSelect, onRename, onDuplicate, onDelete,
}: SceneRowProps) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div
          role="button"
          tabIndex={0}
          aria-current={isProgram || isPreview ? 'true' : undefined}
          aria-label={scene.name}
          onClick={onSelect}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect() }
          }}
          className={cn(
            'flex items-center gap-2 h-10 px-3 cursor-pointer select-none',
            'focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-accent-start',
            'border-b border-bg-divider transition-colors',
            isProgram && studioMode
              ? 'bg-state-danger/10 border-l-2 border-l-state-danger text-text-primary'
              : isPreview
              ? 'bg-state-active border-l-2 border-l-accent-start text-text-primary'
              : !studioMode && isProgram
              ? 'bg-state-active border-l-2 border-l-accent-start text-text-primary'
              : 'text-text-secondary hover:bg-state-hover hover:text-text-primary',
          )}
        >
          {/* Thumbnail placeholder */}
          <div className="w-12 h-7 rounded-sm bg-bg-base flex-shrink-0 overflow-hidden">
            <div className="w-full h-full bg-bg-divider opacity-40" />
          </div>

          <span className="flex-1 text-caption truncate">{scene.name}</span>

          {/* Studio Mode badges */}
          {studioMode && isProgram && (
            <span className="text-[9px] font-bold text-state-danger bg-state-danger/15 px-1 py-0.5 rounded flex-shrink-0">
              PGM
            </span>
          )}
          {studioMode && isPreview && !isProgram && (
            <span className="text-[9px] font-bold text-accent-start bg-state-active px-1 py-0.5 rounded flex-shrink-0">
              PRV
            </span>
          )}
        </div>
      </ContextMenu.Trigger>

      <ContextMenu.Portal>
        <ContextMenu.Content className="context-menu-content">
          <ContextMenu.Item className="context-menu-item" onSelect={onRename}>
            <Edit2 size={12} /> Rename
          </ContextMenu.Item>
          <ContextMenu.Item className="context-menu-item" onSelect={onDuplicate}>
            <Copy size={12} /> Duplicate
          </ContextMenu.Item>
          <ContextMenu.Separator className="h-px bg-bg-divider my-1" />
          <ContextMenu.Item
            className="context-menu-item text-state-danger focus:text-state-danger"
            onSelect={onDelete}
          >
            <Trash2 size={12} /> Delete
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}

/**
 * How a scene is changed when one is clicked: a cut, or a fade, slide or wipe of
 * a chosen length. The same choice is used by the Transition button in Studio Mode.
 */
function TransitionChoice() {
  const type = useTransitionStore((s) => s.type)
  const durationMs = useTransitionStore((s) => s.durationMs)
  const setType = useTransitionStore((s) => s.setType)
  const setDuration = useTransitionStore((s) => s.setDuration)

  return (
    <div className="flex items-center gap-1 ml-auto text-caption text-text-muted">
      <select
        aria-label="Transition"
        value={type}
        onChange={(e) => setType(e.target.value as TransitionType)}
        className="h-6 px-1 rounded-input bg-bg-panel border border-bg-divider text-caption text-text-primary focus:outline-none focus:border-accent-start"
      >
        <option value="cut">Cut</option>
        <option value="fade">Fade</option>
        <option value="slide">Slide</option>
        <option value="wipe">Wipe</option>
      </select>
      {type !== 'cut' && (
        <input
          type="number"
          aria-label="Transition length in milliseconds"
          min={50}
          max={3000}
          step={50}
          value={durationMs}
          onChange={(e) => {
            const n = Number(e.target.value)
            if (Number.isFinite(n)) setDuration(Math.max(50, Math.min(3000, n)))
          }}
          className="w-14 h-6 px-1 rounded-input bg-bg-panel border border-bg-divider text-caption text-text-primary text-center focus:outline-none focus:border-accent-start"
        />
      )}
      {type !== 'cut' && <span>ms</span>}
    </div>
  )
}
