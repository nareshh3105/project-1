import { useState } from 'react'
import { Radio, Circle, Camera, RotateCcw, Video, Settings, Square, Save } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/uiStore'
import { useOutputStore } from '@/stores/outputStore'
import { ipc } from '@/ipc'

export function ControlsPanel() {
  const openModal     = useUIStore((s) => s.openModal)
  const { recording, streaming, replayBuffer, stream } = useOutputStore((s) => ({
    recording:    s.recording,
    streaming:    s.streaming,
    replayBuffer: s.replayBuffer,
    stream:       s.stream,
  }))

  const [recError,     setRecError]     = useState<string | null>(null)
  const [streamError,  setStreamError]  = useState<string | null>(null)
  const [replayError,  setReplayError]  = useState<string | null>(null)
  const [replaySaved,  setReplaySaved]  = useState<string | null>(null)
  const [recLoading,   setRecLoading]   = useState(false)
  const [replayLoading, setReplayLoading] = useState(false)

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
          label="Start Virtual Camera"
          variant="default"
          disabled
        />

        <div className="h-px bg-bg-divider my-1" />

        {/* Screenshot */}
        <ControlButton
          icon={<Camera size={14} />}
          label="Screenshot"
          variant="ghost"
          disabled
        />

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
