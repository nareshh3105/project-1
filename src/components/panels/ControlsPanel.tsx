import { useState } from 'react'
import { Radio, Circle, Camera, RotateCcw, Video, Settings, Square, Save } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/uiStore'
import { useOutputStore } from '@/stores/outputStore'
import { ipc } from '@/ipc'

export function ControlsPanel() {
  const openModal     = useUIStore((s) => s.openModal)
  const { recording, streaming, replayBuffer, virtualCamera, stream } = useOutputStore((s) => ({
    recording:     s.recording,
    streaming:     s.streaming,
    replayBuffer:  s.replayBuffer,
    virtualCamera: s.virtualCamera,
    stream:        s.stream,
  }))

  const [recError,     setRecError]     = useState<string | null>(null)
  const [streamError,  setStreamError]  = useState<string | null>(null)
  const [replayError,  setReplayError]  = useState<string | null>(null)
  const [replaySaved,  setReplaySaved]  = useState<string | null>(null)
  const [recLoading,   setRecLoading]   = useState(false)
  const [replayLoading,  setReplayLoading]  = useState(false)
  const [vcamError,      setVcamError]      = useState<string | null>(null)
  const [vcamLoading,    setVcamLoading]    = useState(false)
  const [screenshotMsg,  setScreenshotMsg]  = useState<string | null>(null)
  const [screenshotErr,  setScreenshotErr]  = useState<string | null>(null)

  async function handleRecording() {
    setRecError(null)
    setRecLoading(true)
    try {
      if (recording.active) {
        await ipc.output.stopRecording()
      } else {
        await ipc.output.startRecording()
      }
    } catch (e) {
      setRecError(String(e))
    } finally {
      setRecLoading(false)
    }
  }

  async function handleReplay() {
    setReplayError(null)
    setReplaySaved(null)
    setReplayLoading(true)
    try {
      if (replayBuffer.active) {
        await ipc.replay.stop()
      } else {
        await ipc.replay.start(30)
      }
    } catch (e) {
      setReplayError(String(e))
    } finally {
      setReplayLoading(false)
    }
  }

  async function handleSaveReplay() {
    setReplayError(null)
    setReplaySaved(null)
    try {
      const path = await ipc.replay.save()
      setReplaySaved(path)
      setTimeout(() => setReplaySaved(null), 5000)
    } catch (e) {
      setReplayError(String(e))
    }
  }

  async function handleVirtualCamera() {
    setVcamError(null)
    setVcamLoading(true)
    try {
      if (virtualCamera.active) {
        await ipc.output.stopVirtualCamera()
      } else {
        await ipc.output.startVirtualCamera()
      }
    } catch (e) {
      setVcamError(String(e))
    } finally {
      setVcamLoading(false)
    }
  }

  async function handleScreenshot() {
    setScreenshotMsg(null)
    setScreenshotErr(null)
    try {
      const path = await ipc.screenshot.take()
      setScreenshotMsg(path.split(/[/\\]/).pop() ?? 'Saved')
      setTimeout(() => setScreenshotMsg(null), 4000)
    } catch (e) {
      setScreenshotErr(String(e))
      setTimeout(() => setScreenshotErr(null), 4000)
    }
  }

  function handleStreaming() {
    setStreamError(null)
    if (streaming.active) {
      ipc.output.stopStreaming().catch((e) => setStreamError(String(e)))
    } else {
      // Open stream settings modal — it handles start on confirm
      openModal('stream-settings')
    }
  }

  return (
    <div className="flex flex-col h-full bg-bg-surface overflow-hidden">
      <div className="panel-header">
        <span className="panel-header-title">Controls</span>
      </div>

      <div className="flex-1 flex flex-col p-3 gap-2 overflow-y-auto">
        {/* Streaming */}
        <ControlButton
          icon={streaming.active ? <Square size={14} /> : <Radio size={14} />}
          label={streaming.active ? 'Stop Streaming' : 'Start Streaming'}
          variant={streaming.active ? 'danger' : 'default'}
          onClick={handleStreaming}
        />
        {streamError && (
          <p className="text-[10px] text-state-danger px-2 -mt-1 leading-tight">{streamError}</p>
        )}

        {/* Recording */}
        <ControlButton
          icon={recording.active ? <Square size={14} /> : <Circle size={14} />}
          label={
            recLoading
              ? (recording.active ? 'Stopping…' : 'Starting…')
              : recording.active
              ? 'Stop Recording'
              : 'Start Recording'
          }
          variant={recording.active ? 'danger' : 'default'}
          onClick={handleRecording}
          disabled={recLoading}
        />
        {recError && (
          <p className="text-[10px] text-state-danger px-2 -mt-1 leading-tight">{recError}</p>
        )}

        {/* Replay Buffer */}
        <ControlButton
          icon={<RotateCcw size={14} />}
          label={
            replayLoading
              ? (replayBuffer.active ? 'Stopping…' : 'Starting…')
              : replayBuffer.active
              ? 'Stop Replay Buffer'
              : 'Start Replay Buffer'
          }
          variant={replayBuffer.active ? 'danger' : 'default'}
          onClick={handleReplay}
          disabled={replayLoading}
        />
        {replayBuffer.active && (
          <ControlButton
            icon={<Save size={14} />}
            label="Save Replay"
            variant="default"
            onClick={handleSaveReplay}
          />
        )}
        {replayError && (
          <p className="text-[10px] text-state-danger px-2 -mt-1 leading-tight">{replayError}</p>
        )}
        {replaySaved && (
          <p className="text-[10px] text-state-success px-2 -mt-1 leading-tight truncate" title={replaySaved}>
            Saved: {replaySaved.split(/[/\\]/).pop()}
          </p>
        )}

        {/* Virtual Camera */}
        <ControlButton
          icon={<Video size={14} />}
          label={
            vcamLoading
              ? (virtualCamera.active ? 'Stopping…' : 'Starting…')
              : virtualCamera.active
              ? 'Stop Virtual Camera'
              : 'Start Virtual Camera'
          }
          variant={virtualCamera.active ? 'danger' : 'default'}
          onClick={handleVirtualCamera}
          disabled={vcamLoading}
        />
        {virtualCamera.active && virtualCamera.url && (
          <p className="text-[10px] text-text-muted px-2 -mt-1 leading-tight truncate" title={virtualCamera.url}>
            {virtualCamera.url}
          </p>
        )}
        {vcamError && (
          <p className="text-[10px] text-state-danger px-2 -mt-1 leading-tight">{vcamError}</p>
        )}

        <div className="h-px bg-bg-divider my-1" />

        {/* Screenshot */}
        <ControlButton
          icon={<Camera size={14} />}
          label="Screenshot"
          variant="ghost"
          onClick={handleScreenshot}
        />
        {screenshotMsg && (
          <p className="text-[10px] text-state-success px-2 -mt-1 leading-tight truncate" title={screenshotMsg}>
            Saved: {screenshotMsg}
          </p>
        )}
        {screenshotErr && (
          <p className="text-[10px] text-state-danger px-2 -mt-1 leading-tight">{screenshotErr}</p>
        )}

        {/* Settings */}
        <ControlButton
          icon={<Settings size={14} />}
          label="Settings"
          variant="ghost"
          onClick={() => openModal('settings')}
        />
      </div>
    </div>
  )
}

interface ControlButtonProps {
  icon:      React.ReactNode
  label:     string
  variant:   'default' | 'danger' | 'ghost'
  disabled?: boolean
  onClick?:  () => void
}

function ControlButton({ icon, label, variant, disabled, onClick }: ControlButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'w-full flex items-center gap-2 px-3 h-8 rounded-button text-body font-medium',
        'transition-colors duration-100 disabled:opacity-40 disabled:cursor-not-allowed',
        variant === 'default' && 'bg-bg-panel text-text-secondary hover:bg-state-hover hover:text-text-primary',
        variant === 'danger'  && 'bg-state-danger/20 text-state-danger hover:bg-state-danger/30',
        variant === 'ghost'   && 'text-text-muted hover:text-text-primary hover:bg-state-hover',
      )}
    >
      <span className="flex-shrink-0">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  )
}
