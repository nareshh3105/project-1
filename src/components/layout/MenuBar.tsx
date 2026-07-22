import { useUIStore } from '@/stores/uiStore'
import { cn } from '@/lib/utils'

const MENU_ITEMS = ['File', 'Edit', 'View', 'Profile', 'Scene Collection', 'Plugins', 'Tools', 'Help'] as const

type MenuItem = typeof MENU_ITEMS[number]

export function MenuBar() {
  const openModal = useUIStore((s) => s.openModal)

  function handleMenuClick(item: MenuItem) {
    if (item === 'File') {
      // Phase 3: file menu dropdown
    } else if (item === 'Plugins') {
      openModal('plugins')
    } else if (item === 'Tools') {
      openModal('settings')
    } else if (item === 'Profile') {
      openModal('profile-manager')
    } else if (item === 'Scene Collection') {
      openModal('scene-collection')
    } else if (item === 'Help') {
      openModal('updater')
    }
  }

  return (
    <header
      className="flex items-center h-menubar bg-bg-surface border-b border-bg-divider flex-shrink-0 select-none"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* App icon */}
      <div
        className="w-8 h-8 flex items-center justify-center flex-shrink-0"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <div className="w-5 h-5 rounded-[5px] bg-accent-gradient shadow-glow" />
      </div>

      {/* Menu items */}
      <nav
        className="flex items-center h-full"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {MENU_ITEMS.map((item) => (
          <MenuBarItem
            key={item}
            label={item}
            onClick={() => handleMenuClick(item)}
          />
        ))}
      </nav>

      {/* Spacer — draggable */}
      <div className="flex-1" />
    </header>
  )
}

function MenuBarItem({
  label,
  onClick,
}: {
  label: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'h-full px-3 text-caption text-text-muted',
        'hover:text-text-primary hover:bg-state-hover',
        'transition-colors duration-100 focus-visible:outline-none'
      )}
    >
      {label}
    </button>
  )
}
