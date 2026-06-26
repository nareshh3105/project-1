import { useUIStore } from '@/stores/uiStore'
import { useOutputStore } from '@/stores/outputStore'
import { formatBitrate, formatDuration } from '@/lib/utils'
import { cn } from '@/lib/utils'

export function StatusBar() {
  const stats = useUIStore((s) => s.stats)
  const { recording, streaming } = useOutputStore((s) => ({
    recording: s.recording,
    streaming: s.streaming,
  }))

  const isLive = streaming.active
  const isRec  = recording.active

  return (
    <footer className="flex items-center h-statusbar bg-bg-surface border-t border-bg-divider flex-shrink-0 px-3 gap-4 text-caption text-text-muted">
      {/* Stream status */}
      <StatusPill
        label="STREAM"
        value={isLive ? formatDuration(streaming.elapsed) : 'Offline'}
        color={isLive ? 'live' : 'muted'}
      />

      {/* Recording status */}
      <StatusPill
        label="REC"
        value={isRec ? formatDuration(recording.elapsed) : 'Stopped'}
        color={isRec ? 'recording' : 'muted'}
      />

      <div className="flex-1" />

      {/* Live stats */}
      {stats ? (
        <>
          <StatItem label="CPU"     value={`${stats.cpuPercent.toFixed(1)}%`} />
          <StatItem label="RAM"     value={`${stats.memoryMb.toFixed(0)} MB`} />
          <StatItem label="FPS"     value={`${stats.renderFps.toFixed(0)}`} />
          <StatItem label="Bitrate" value={formatBitrate(stats.outputBitrateBps)} />
          <StatItem
            label="Dropped"
            value={`${stats.skippedFramesRender + stats.skippedFramesEncode}`}
          />
        </>
      ) : (
        <span className="text-text-muted opacity-40">No active output</span>
      )}

      <div className="flex-1" />

      {/* Duration — longest active session */}
      <StatItem
        label="Duration"
        value={isRec
          ? formatDuration(recording.elapsed)
          : isLive
          ? formatDuration(streaming.elapsed)
          : formatDuration(0)
        }
      />
    </footer>
  )
}

function StatusPill({
  label, value, color,
}: {
  label: string
  value: string
  color: 'muted' | 'live' | 'recording' | 'danger'
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className={cn(
          'w-1.5 h-1.5 rounded-full',
          color === 'live'      && 'bg-state-success animate-pulse',
          color === 'recording' && 'bg-state-danger animate-pulse',
          color === 'danger'    && 'bg-state-danger',
          color === 'muted'     && 'bg-bg-divider',
        )}
      />
      <span className="font-medium text-text-muted">{label}</span>
      <span className={cn(
        'opacity-70',
        color === 'live'      && 'text-state-success',
        color === 'recording' && 'text-state-danger',
        color === 'muted'     && 'text-text-muted',
      )}>
        {value}
      </span>
    </div>
  )
}

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-text-muted opacity-50">{label}:</span>
      <span className="text-text-secondary">{value}</span>
    </div>
  )
}
