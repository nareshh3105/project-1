import { useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check } from 'lucide-react'
import { useUIStore } from '@/stores/uiStore'
import { useSceneStore } from '@/stores/sceneStore'
import { useCollectionStore } from '@/stores/collectionStore'
import { useProfileStore } from '@/stores/profileStore'
import { usePluginStore } from '@/stores/pluginStore'
import { useOutputStore } from '@/stores/outputStore'
import { ipc } from '@/ipc'
import { cn } from '@/lib/utils'

const REPO_URL = 'https://github.com/nareshh3105/project-1'

// ── Menu primitives ─────────────────────────────────────────────────────────

const itemClass = cn(
  'flex items-center gap-2 h-7 px-2.5 rounded-[4px] text-caption cursor-pointer select-none outline-none',
  'text-text-secondary data-[highlighted]:bg-state-hover data-[highlighted]:text-text-primary',
  'data-[disabled]:opacity-35 data-[disabled]:pointer-events-none transition-colors',
)

function Item({
  label, onSelect, disabled, checked, shortcut,
}: {
  label: string
  onSelect?: () => void
  disabled?: boolean
  checked?: boolean
  shortcut?: string
}) {
  return (
    <DropdownMenu.Item className={itemClass} disabled={disabled} onSelect={onSelect}>
      <span className="w-3.5 flex-shrink-0 flex items-center justify-center">
        {checked && <Check size={11} className="text-accent-start" />}
      </span>
      <span className="flex-1 truncate">{label}</span>
      {shortcut && (
        <span className="text-[10px] text-text-muted opacity-50 ml-4 flex-shrink-0">{shortcut}</span>
      )}
    </DropdownMenu.Item>
  )
}

function Sep() {
  return <DropdownMenu.Separator className="h-px bg-bg-divider my-1 -mx-1" />
}

function Menu({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          className={cn(
            'h-full px-3 text-caption text-text-muted outline-none',
            'hover:text-text-primary hover:bg-state-hover',
            'data-[state=open]:text-text-primary data-[state=open]:bg-state-hover',
            'transition-colors duration-100',
          )}
        >
          {label}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={1}
          className={cn(
            'min-w-[210px] max-h-[70vh] overflow-y-auto z-[80] p-1',
            'bg-bg-panel border border-bg-divider rounded-[8px] shadow-modal',
            'animate-fade-in',
          )}
        >
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

// ── MenuBar ─────────────────────────────────────────────────────────────────

export function MenuBar() {
  const {
    openModal, studioMode, toggleStudioMode,
    statsOverlayVisible, toggleStatsOverlay, resetLayout,
  } = useUIStore((s) => ({
    openModal:           s.openModal,
    studioMode:          s.studioMode,
    toggleStudioMode:    s.toggleStudioMode,
    statsOverlayVisible: s.statsOverlayVisible,
    toggleStatsOverlay:  s.toggleStatsOverlay,
    resetLayout:         s.resetLayout,
  }))

  const { scenes, activeSceneId, duplicateScene, deleteScene, createScene } = useSceneStore((s) => ({
    scenes:         s.scenes,
    activeSceneId:  s.activeSceneId,
    duplicateScene: s.duplicateScene,
    deleteScene:    s.deleteScene,
    createScene:    s.createScene,
  }))

  const { collections, activeCollectionId, switchCollection, importCollection, exportCollection } =
    useCollectionStore((s) => ({
      collections:        s.collections,
      activeCollectionId: s.activeCollectionId,
      switchCollection:   s.switchCollection,
      importCollection:   s.importCollection,
      exportCollection:   s.exportCollection,
    }))

  const { profiles, activeProfileId, switchProfile } = useProfileStore((s) => ({
    profiles:        s.profiles,
    activeProfileId: s.activeProfileId,
    switchProfile:   s.switchProfile,
  }))

  const { discoverPlugins, openPluginsFolder } = usePluginStore((s) => ({
    discoverPlugins:   s.discoverPlugins,
    openPluginsFolder: s.openPluginsFolder,
  }))

  const { virtualCamera, ffmpegAvailable } = useOutputStore((s) => ({
    virtualCamera:   s.virtualCamera,
    ffmpegAvailable: s.ffmpegAvailable,
  }))

  const [alwaysOnTop, setAlwaysOnTop] = useState(false)
  const [fullscreen,  setFullscreen]  = useState(false)

  const noFfmpeg = ffmpegAvailable === false

  // ── Actions ───────────────────────────────────────────────────────────────

  async function toggleAlwaysOnTop() {
    const next = !alwaysOnTop
    setAlwaysOnTop(next)
    try { await ipc.window.setAlwaysOnTop(next) } catch { /* no window host */ }
  }

  async function toggleFullscreen() {
    const next = !fullscreen
    setFullscreen(next)
    try { await ipc.window.setFullscreen(next) } catch { /* no window host */ }
  }

  async function exitApp() {
    try { await ipc.window.close() } catch { /* no window host */ }
  }

  function handleResetLayout() {
    resetLayout()
    window.location.reload()
  }

  async function toggleVirtualCamera() {
    try {
      if (virtualCamera.active) await ipc.output.stopVirtualCamera()
      else                      await ipc.output.startVirtualCamera()
    } catch { /* surfaced in ControlsPanel */ }
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

      <nav
        className="flex items-center h-full"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {/* ── File ── */}
        <Menu label="File">
          <Item label="New Scene"              onSelect={() => createScene(`Scene ${scenes.length + 1}`)} />
          <Item label="New Scene Collection…"  onSelect={() => openModal('scene-collection')} />
          <Sep />
          <Item label="Import Scene Collection…" onSelect={() => importCollection()} />
          <Item
            label="Export Scene Collection…"
            disabled={!activeCollectionId}
            onSelect={() => activeCollectionId && exportCollection(activeCollectionId)}
          />
          <Sep />
          <Item label="Show Recordings Folder"  onSelect={() => ipc.output.openRecordingsFolder().catch(() => {})} />
          <Item label="Show Screenshots Folder" onSelect={() => ipc.output.openScreenshotsFolder().catch(() => {})} />
          <Sep />
          <Item label="Settings"  onSelect={() => openModal('settings')} shortcut="Ctrl+," />
          <Sep />
          <Item label="Exit" onSelect={exitApp} shortcut="Alt+F4" />
        </Menu>

        {/* ── Edit ── */}
        <Menu label="Edit">
          <Item
            label="Duplicate Scene"
            disabled={!activeSceneId}
            onSelect={() => activeSceneId && duplicateScene(activeSceneId)}
          />
          <Item
            label="Delete Scene"
            disabled={!activeSceneId || scenes.length <= 1}
            onSelect={() => activeSceneId && deleteScene(activeSceneId)}
          />
          <Sep />
          <Item label="Stream Settings…" onSelect={() => openModal('stream-settings')} />
          <Item label="Settings…"        onSelect={() => openModal('settings')} />
        </Menu>

        {/* ── View ── */}
        <Menu label="View">
          <Item label="Studio Mode"    checked={studioMode}          onSelect={toggleStudioMode} />
          <Item label="Stats Panel"    checked={statsOverlayVisible} onSelect={toggleStatsOverlay} />
          <Sep />
          <Item label="Fullscreen"     checked={fullscreen}  onSelect={toggleFullscreen}  shortcut="F11" />
          <Item label="Always on Top"  checked={alwaysOnTop} onSelect={toggleAlwaysOnTop} />
          <Sep />
          <Item label="Reset Layout"   onSelect={handleResetLayout} />
        </Menu>

        {/* ── Profile ── */}
        <Menu label="Profile">
          {profiles.map((p) => (
            <Item
              key={p.id}
              label={p.name}
              checked={p.id === activeProfileId}
              onSelect={() => switchProfile(p.id)}
            />
          ))}
          <Sep />
          <Item label="Manage Profiles…" onSelect={() => openModal('profile-manager')} />
        </Menu>

        {/* ── Scene Collection ── */}
        <Menu label="Scene Collection">
          {collections.map((c) => (
            <Item
              key={c.id}
              label={c.name}
              checked={c.id === activeCollectionId}
              onSelect={() => switchCollection(c.id)}
            />
          ))}
          <Sep />
          <Item label="Manage Collections…" onSelect={() => openModal('scene-collection')} />
          <Sep />
          <Item label="Import…" onSelect={() => importCollection()} />
          <Item
            label="Export…"
            disabled={!activeCollectionId}
            onSelect={() => activeCollectionId && exportCollection(activeCollectionId)}
          />
        </Menu>

        {/* ── Plugins ── */}
        <Menu label="Plugins">
          <Item label="Browse Plugins…"     onSelect={() => openModal('plugins')} />
          <Sep />
          <Item label="Rescan Plugins"      onSelect={() => discoverPlugins()} />
          <Item label="Open Plugins Folder" onSelect={() => openPluginsFolder()} />
        </Menu>

        {/* ── Tools ── */}
        <Menu label="Tools">
          <Item
            label="Take Screenshot"
            onSelect={() => ipc.screenshot.take().catch(() => {})}
          />
          <Item
            label={virtualCamera.active ? 'Stop Virtual Camera' : 'Start Virtual Camera'}
            disabled={noFfmpeg && !virtualCamera.active}
            onSelect={toggleVirtualCamera}
          />
          <Sep />
          <Item label="Stream Settings…" onSelect={() => openModal('stream-settings')} />
          <Item label="Settings…"        onSelect={() => openModal('settings')} />
        </Menu>

        {/* ── Help ── */}
        <Menu label="Help">
          <Item label="About CodeBuilders" onSelect={() => openModal('about')} />
          <Item label="Check for Updates…" onSelect={() => openModal('updater')} />
          <Sep />
          <Item label="Documentation" onSelect={() => window.open(REPO_URL, '_blank')} />
          <Item label="Report a Bug"  onSelect={() => window.open(`${REPO_URL}/issues/new`, '_blank')} />
        </Menu>
      </nav>

      {/* Spacer — draggable */}
      <div className="flex-1" />
    </header>
  )
}
