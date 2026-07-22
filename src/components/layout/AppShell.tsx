import { useEffect } from 'react'
import { MenuBar }       from './MenuBar'
import { Toolbar }       from './Toolbar'
import { DockLayout }    from './DockLayout'
import { StatusBar }     from './StatusBar'
import { useUIStore }    from '@/stores/uiStore'
import { useSceneStore } from '@/stores/sceneStore'
import { useOutputStore } from '@/stores/outputStore'
import { SettingsModal }         from '@/components/modals/SettingsModal'
import { StreamSettingsModal }   from '@/components/modals/StreamSettingsModal'
import { FiltersModal }          from '@/components/modals/FiltersModal'
import { SceneCollectionModal }  from '@/components/modals/SceneCollectionModal'
import { ProfileModal }          from '@/components/modals/ProfileModal'
import { PluginsModal }          from '@/components/modals/PluginsModal'
import { useCollectionStore } from '@/stores/collectionStore'
import { usePluginStore }     from '@/stores/pluginStore'
import { useHotkeyStore }     from '@/stores/hotkeyStore'
import {
  ipc,
  onRecordingStatus,
  onStreamingStatus,
  onStatsUpdate,
} from '@/ipc'

export function AppShell() {
  const setAppReady     = useUIStore((s) => s.setAppReady)
  const setStats        = useUIStore((s) => s.setStats)
  const initApp         = useSceneStore((s) => s.initApp)
  const loadCollections = useCollectionStore((s) => s.loadCollections)
  const loadPlugins         = usePluginStore((s) => s.loadPlugins)
  const syncGlobalShortcuts = useHotkeyStore((s) => s.syncGlobalShortcuts)

  const {
    setRecordingStatus,
    setStreamingStatus,
    setFfmpegAvailable,
    tickElapsed,
  } = useOutputStore((s) => ({
    setRecordingStatus:  s.setRecordingStatus,
    setStreamingStatus:  s.setStreamingStatus,
    setFfmpegAvailable:  s.setFfmpegAvailable,
    tickElapsed:         s.tickElapsed,
  }))

  // App init
  useEffect(() => {
    initApp().then(() => {
      setAppReady(true)
      loadCollections()
      loadPlugins()
      syncGlobalShortcuts()
      ipc.stats.startPolling().catch(console.warn)
    })
  }, [initApp, setAppReady, loadCollections, loadPlugins, syncGlobalShortcuts])

  // Check ffmpeg availability once on mount
  useEffect(() => {
    ipc.output.checkFfmpeg()
      .then(setFfmpegAvailable)
      .catch(() => setFfmpegAvailable(false))
  }, [setFfmpegAvailable])

  // Subscribe to output status events from Rust
  useEffect(() => {
    let unlistenRec:    (() => void) | null = null
    let unlistenStream: (() => void) | null = null
    let unlistenStats:  (() => void) | null = null

    onRecordingStatus((p) => setRecordingStatus(p.active, p.filePath))
      .then((u) => { unlistenRec = u })

    onStreamingStatus((p) => setStreamingStatus(p.active))
      .then((u) => { unlistenStream = u })

    onStatsUpdate((stats) => setStats(stats))
      .then((u) => { unlistenStats = u })

    return () => {
      unlistenRec?.()
      unlistenStream?.()
      unlistenStats?.()
    }
  }, [setRecordingStatus, setStreamingStatus, setStats])

  // Elapsed timer — ticks every second when recording/streaming is active
  useEffect(() => {
    const id = setInterval(tickElapsed, 1000)
    return () => clearInterval(id)
  }, [tickElapsed])

  return (
    <div className="flex flex-col h-full overflow-hidden bg-bg-base">
      <MenuBar />
      <Toolbar />
      <div className="h-px bg-bg-divider flex-shrink-0" />
      <DockLayout />
      <StatusBar />

      {/* Modal layer */}
      <SettingsModal />
      <StreamSettingsModal />
      <FiltersModal />
      <SceneCollectionModal />
      <ProfileModal />
      <PluginsModal />
    </div>
  )
}
