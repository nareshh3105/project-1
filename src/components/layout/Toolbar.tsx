import {
  Layers2,
  Maximize2,
  Camera,
  BarChart2,
  Grid2X2,
  FolderOpen,
  Settings,
} from 'lucide-react'
import { useUIStore } from '@/stores/uiStore'
import { cn } from '@/lib/utils'

interface ToolbarButton {
  icon: React.ReactNode
  title: string
  action: () => void
  active?: boolean
}

export function Toolbar() {
  const { studioMode, statsOverlayVisible, toggleStudioMode, toggleStatsOverlay, openModal } =
    useUIStore((s) => ({
      studioMode:          s.studioMode,
      statsOverlayVisible: s.statsOverlayVisible,
      toggleStudioMode:    s.toggleStudioMode,
      toggleStatsOverlay:  s.toggleStatsOverlay,
      openModal:           s.openModal,
    }))

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
      action: () => { /* Phase 3 */ },
    },
    {
      icon:   <Camera size={16} />,
      title:  'Screenshot',
      action: () => { /* Phase 3 */ },
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
      action: () => { /* Phase 3 */ },
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
    </div>
  )
}
