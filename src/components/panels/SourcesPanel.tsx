import { useState } from 'react'
import {
  Plus, Minus, Eye, EyeOff, Lock, Unlock, Trash2, Edit2,
  ChevronUp, ChevronDown, SlidersHorizontal,
  Monitor, AppWindow, Gamepad2, Camera, Speaker, Mic,
  Image, Film, Globe, Palette, Type, Layers,
} from 'lucide-react'
import * as ContextMenu from '@radix-ui/react-context-menu'
import { useSceneStore } from '@/stores/sceneStore'
import { useSourceStore, type SourceItem } from '@/stores/sourceStore'
import { useUIStore } from '@/stores/uiStore'
import { useFilterStore } from '@/stores/filterStore'
import { AddSourceModal } from '@/components/modals/AddSourceModal'
import { RenameModal } from '@/components/modals/RenameModal'
import { ConfirmModal } from '@/components/modals/ConfirmModal'
import type { SourceType } from '@/types'
import { cn } from '@/lib/utils'

function sourceIcon(type: SourceType) {
  const props = { size: 12, className: 'flex-shrink-0' }
  switch (type) {
    case 'display_capture':  return <Monitor {...props} />
    case 'window_capture':   return <AppWindow {...props} />
    case 'game_capture':     return <Gamepad2 {...props} />
    case 'dshow_video':      return <Camera {...props} />
    case 'wasapi_output':    return <Speaker {...props} />
    case 'wasapi_input':     return <Mic {...props} />
    case 'image':            return <Image {...props} />
    case 'media_source':     return <Film {...props} />
    case 'browser_source':   return <Globe {...props} />
    case 'color_source':     return <Palette {...props} />
    case 'text_gdi_plus':    return <Type {...props} />
    case 'scene':            return <Layers {...props} />
    default:                 return <Monitor {...props} />
  }
}

export function SourcesPanel() {
  const activeSceneId = useSceneStore((s) => s.activeSceneId)
  const { byScene, addSource, removeSource, renameSource, setVisible, setLocked, moveUp, moveDown } =
    useSourceStore((s) => ({
      byScene:      s.byScene,
      addSource:    s.addSource,
      removeSource: s.removeSource,
      renameSource: s.renameSource,
      setVisible:   s.setVisible,
      setLocked:    s.setLocked,
      moveUp:       s.moveUp,
      moveDown:     s.moveDown,
    }))

  const openModal      = useUIStore((s) => s.openModal)
  const filtersBySource = useFilterStore((s) => s.filtersBySource)

  const sources = (activeSceneId ? byScene[activeSceneId] : []) ?? []
  const reversedSources = [...sources].reverse() // top layer first in UI

  const [addOpen,      setAddOpen]      = useState(false)
  const [renameTarget, setRenameTarget] = useState<SourceItem | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<SourceItem | null>(null)
  const [selected,     setSelected]     = useState<string | null>(null)

  async function handleAdd(type: SourceType, name: string) {
    if (!activeSceneId) return
    await addSource(activeSceneId, name, type)
  }

  function openFilters(src: SourceItem) {
    openModal('filters', { sourceId: src.id, sourceName: src.name })
  }

  return (
    <div className="flex flex-col h-full bg-bg-surface overflow-hidden">
      {/* Header */}
      <div className="panel-header">
        <span className="panel-header-title">Sources</span>
        <button
          className="icon-btn"
          title="Add source"
          onClick={() => setAddOpen(true)}
          disabled={!activeSceneId}
        >
          <Plus size={12} />
        </button>
      </div>

      {/* Source list */}
      <div className="flex-1 overflow-y-auto">
        {!activeSceneId ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-caption text-text-muted">Select a scene first</p>
          </div>
        ) : sources.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <p className="text-caption text-text-muted">No sources</p>
            <button
              onClick={() => setAddOpen(true)}
              className="text-caption text-accent-start hover:underline"
            >
              Add a source
            </button>
          </div>
        ) : (
          reversedSources.map((src) => (
            <SourceRow
              key={src.id}
              source={src}
              selected={selected === src.id}
              hasFilters={(filtersBySource[src.id]?.length ?? 0) > 0}
              onSelect={() => setSelected(src.id)}
              onToggleVisible={() => setVisible(src.sceneId, src.id, !src.visible)}
              onToggleLocked={() => setLocked(src.sceneId, src.id, !src.locked)}
              onRename={() => setRenameTarget(src)}
              onDelete={() => setDeleteTarget(src)}
              onMoveUp={() => moveUp(src.sceneId, src.id)}
              onMoveDown={() => moveDown(src.sceneId, src.id)}
              onFilters={() => openFilters(src)}
            />
          ))
        )}
      </div>

      {/* Bottom toolbar */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-t border-bg-divider">
        <button
          className="icon-btn" title="Add source"
          onClick={() => setAddOpen(true)} disabled={!activeSceneId}
        >
          <Plus size={12} />
        </button>
        <button
          className="icon-btn" title="Remove selected"
          onClick={() => selected && activeSceneId && removeSource(activeSceneId, selected)}
          disabled={!selected}
        >
          <Minus size={12} />
        </button>
        <div className="w-px h-4 bg-bg-divider mx-0.5" />
        <button
          className="icon-btn" title="Move up"
          onClick={() => selected && activeSceneId && moveUp(activeSceneId, selected)}
          disabled={!selected}
        >
          <ChevronUp size={12} />
        </button>
        <button
          className="icon-btn" title="Move down"
          onClick={() => selected && activeSceneId && moveDown(activeSceneId, selected)}
          disabled={!selected}
        >
          <ChevronDown size={12} />
        </button>
      </div>

      {/* Modals */}
      <AddSourceModal open={addOpen} onAdd={handleAdd} onClose={() => setAddOpen(false)} />
      <RenameModal
        open={!!renameTarget}
        title="Rename Source"
        current={renameTarget?.name ?? ''}
        onConfirm={(name) => renameTarget && renameSource(renameTarget.sceneId, renameTarget.id, name)}
        onClose={() => setRenameTarget(null)}
      />
      <ConfirmModal
        open={!!deleteTarget}
        title="Remove Source"
        message={`Remove "${deleteTarget?.name}" from the scene?`}
        confirmLabel="Remove"
        danger
        onConfirm={() => deleteTarget && removeSource(deleteTarget.sceneId, deleteTarget.id)}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  )
}

interface SourceRowProps {
  source: SourceItem
  selected: boolean
  hasFilters: boolean
  onSelect: () => void
  onToggleVisible: () => void
  onToggleLocked: () => void
  onRename: () => void
  onDelete: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onFilters: () => void
}

function SourceRow({
  source, selected, hasFilters, onSelect, onToggleVisible, onToggleLocked,
  onRename, onDelete, onMoveUp, onMoveDown, onFilters,
}: SourceRowProps) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div
          onClick={onSelect}
          className={cn(
            'flex items-center gap-1.5 h-8 px-2 cursor-pointer select-none group',
            'border-b border-bg-divider transition-colors',
            selected
              ? 'bg-state-active text-text-primary'
              : 'text-text-secondary hover:bg-state-hover hover:text-text-primary'
          )}
        >
          {/* Visibility toggle */}
          <button
            className={cn('icon-btn w-5 h-5', !source.visible && 'opacity-40')}
            onClick={(e) => { e.stopPropagation(); onToggleVisible() }}
            title={source.visible ? 'Hide' : 'Show'}
          >
            {source.visible ? <Eye size={11} /> : <EyeOff size={11} />}
          </button>

          {/* Lock toggle */}
          <button
            className={cn('icon-btn w-5 h-5', source.locked && 'text-state-warning')}
            onClick={(e) => { e.stopPropagation(); onToggleLocked() }}
            title={source.locked ? 'Unlock' : 'Lock'}
          >
            {source.locked ? <Lock size={11} /> : <Unlock size={11} />}
          </button>

          {/* Type icon */}
          <span className="text-text-muted">{sourceIcon(source.sourceType)}</span>

          {/* Name */}
          <span className="flex-1 text-caption truncate">{source.name}</span>

          {/* Filters button — dot indicator when filters exist, always visible on hover */}
          <button
            onClick={(e) => { e.stopPropagation(); onFilters() }}
            title="Filters"
            className={cn(
              'w-5 h-5 flex items-center justify-center rounded transition-all relative',
              'hover:bg-state-hover',
              hasFilters
                ? 'opacity-100 text-accent-start'
                : 'opacity-0 group-hover:opacity-70 text-text-muted',
            )}
          >
            <SlidersHorizontal size={11} />
            {hasFilters && (
              <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-accent-start rounded-full" />
            )}
          </button>
        </div>
      </ContextMenu.Trigger>

      <ContextMenu.Portal>
        <ContextMenu.Content className="context-menu-content">
          <ContextMenu.Item className="context-menu-item" onSelect={onFilters}>
            <SlidersHorizontal size={12} /> Filters…
          </ContextMenu.Item>
          <ContextMenu.Separator className="h-px bg-bg-divider my-1" />
          <ContextMenu.Item className="context-menu-item" onSelect={onRename}>
            <Edit2 size={12} /> Rename
          </ContextMenu.Item>
          <ContextMenu.Item className="context-menu-item" onSelect={onMoveUp}>
            <ChevronUp size={12} /> Move Up
          </ContextMenu.Item>
          <ContextMenu.Item className="context-menu-item" onSelect={onMoveDown}>
            <ChevronDown size={12} /> Move Down
          </ContextMenu.Item>
          <ContextMenu.Separator className="h-px bg-bg-divider my-1" />
          <ContextMenu.Item
            className="context-menu-item text-state-danger focus:text-state-danger"
            onSelect={onDelete}
          >
            <Trash2 size={12} /> Remove
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}
