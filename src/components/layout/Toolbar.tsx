import {
  Layers2,
  Maximize2,
  Camera,
  BarChart2,
  Grid2X2,
  FolderOpen,
  Settings,
} from 'lucide-react'
import { useState } from 'react'
import { useUIStore } from '@/stores/uiStore'
import { ipc } from '@/ipc'
import { cn } from '@/lib/utils'

interface ToolbarButton {
  icon: React.ReactNode
  title: string
  action: () => void
  active?: boolean
}

export function Toolbar() {
  const {
    studioMode, statsOverlayVisible, fullscreenPreview,
    toggleStudioMode, toggleStatsOverlay, toggleFullscreenPreview, openModal,
  } = useUIStore((s) => ({
    studioMode:              s.studioMode,
    statsOverlayVisible:     s.statsOverlayVisible,
    fullscreenPreview:       s.fullscreenPreview,
    toggleStudioMode:        s.toggleStudioMode,
    toggleStatsOverlay:      s.toggleStatsOverlay,
    toggleFullscreenPreview: s.toggleFullscreenPreview,
    openModal:               s.openModal,
  }))

  // Transient feedback for the fire-and-forget actions
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null)

  function flash(text: string, error = false) {
    setToast({ text, error })
    setTimeout(() => setToast(null), 3500)
  }

  async function handleScreenshot() {
    try {
      const path = await ipc.screenshot.take()
      flash(`Saved ${path.split(/[/\\]/).pop()}`)
    } catch (e) {
      flash(String(e), true)
    }
  }

  async function handleOpenRecordings() {
    try {
      await ipc.output.openRecordingsFolder()
    } catch (e) {
      flash(String(e), true)
    }
  }

  const buttons: ToolbarButton[] = [
    {
      icon:   <Layers2 size={16} />,
      title:  'Studio Mode',
      action: toggleStudioMode,
      active: studioMode,
    },
    {
      icon:   <Maximize2 size={16} />,
      title:  'Fullscreen Preview',
      action: toggleFullscreenPreview,
      active: fullscreenPreview,
    },
    {
      icon:   <Camera size={16} />,
      title:  'Screenshot',
      action: handleScreenshot,
    },
    {
      icon:   <BarChart2 size={16} />,
      title:  'Stats',
      action: toggleStatsOverlay,
      active: statsOverlayVisible,
    },
    {
      icon:   <Grid2X2 size={16} />,
      title:  'Multiview',
      action: () => openModal('multiview'),
    },
    {
      icon:   <FolderOpen size={16} />,
      title:  'Open Recording Folder',
      action: handleOpenRecordings,
    },
    {
      icon:   <Settings size={16} />,
      title:  'Settings',
      action: () => openModal('settings'),
    },
  ]

  return (
    <div className="flex items-center h-toolbar bg-bg-surface border-b border-bg-divider flex-shrink-0 px-2 gap-1">
      {buttons.map((btn, i) => (
        <button
          key={i}
          title={btn.title}
          onClick={btn.action}
          className={cn(
            'icon-btn w-8 h-8',
            btn.active && 'icon-btn-active'
          )}
        >
          {btn.icon}
        </button>
      ))}

      {toast && (
        <span
          className={cn(
            'ml-2 text-[10px] leading-tight truncate max-w-[280px]',
            toast.error ? 'text-state-danger' : 'text-state-success',
          )}
          title={toast.text}
        >
          {toast.text}
        </span>
      )}
    </div>
  )
}
