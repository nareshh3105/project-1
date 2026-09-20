import { useEffect, useRef, useCallback, useState } from 'react'
import { useAudioStore, type AudioChannel } from '@/stores/audioStore'
import {
  AudioEngine, requestMicrophone, requestDesktopAudio, type ChannelId,
} from '@/lib/audio/engine'
import { COLOR } from '@/lib/tokens'

// ── dB helpers ─────────────────────────────────────────────────────────────

const DB_MIN = -60
const DB_MAX =   0
const DB_CLIP    = -6
const DB_CAUTION = -20

function dbToFrac(db: number): number {
  return Math.max(0, Math.min(1, (db - DB_MIN) / (DB_MAX - DB_MIN)))
}

function meterColor(db: number): string {
  if (db >= DB_CLIP)    return COLOR.meter.clip
  if (db >= DB_CAUTION) return COLOR.meter.caution
  return COLOR.meter.safe
}

// ── VU Meter bar ───────────────────────────────────────────────────────────

const SEGMENTS = 24

interface MeterBarProps {
  rms:  number   // dBFS
  peak: number   // dBFS (peak hold)
}

function MeterBar({ rms, peak }: MeterBarProps) {
  const rmsF  = dbToFrac(rms)
  const peakF = dbToFrac(peak)

  return (
    <div className="flex-1 flex flex-col-reverse gap-px overflow-hidden relative" style={{ minWidth: 6 }}>
      {Array.from({ length: SEGMENTS }, (_, i) => {
        const segFrac = i / SEGMENTS
        const segDb   = DB_MIN + segFrac * (DB_MAX - DB_MIN)
        const lit     = rmsF > segFrac
        const isPeak  = Math.abs(peakF - segFrac) < 1 / SEGMENTS && peak > DB_MIN + 2
        return (
          <div
            key={i}
            style={{
              flex: '0 0 auto',
              height: `${100 / SEGMENTS}%`,
              borderRadius: 1,
              background: isPeak
                ? meterColor(segDb)
                : lit
                  ? meterColor(segDb)
                  : COLOR.bg.panel,
              opacity: isPeak ? 1 : lit ? 0.9 : 0.2,
            }}
          />
        )
      })}
    </div>
  )
}

// ── Stereo VU meter (L + R) ────────────────────────────────────────────────

interface StereoMeterProps {
  peakL: number; peakR: number
  rmsL:  number; rmsR:  number
}

function StereoMeter({ peakL, peakR, rmsL, rmsR }: StereoMeterProps) {
  return (
    <div className="flex-1 flex gap-px w-full overflow-hidden">
      <MeterBar rms={rmsL} peak={peakL} />
      <MeterBar rms={rmsR} peak={peakR} />
    </div>
  )
}

// ── Vertical fader ─────────────────────────────────────────────────────────

interface FaderProps {
  value:    number   // 0–1
  onChange: (v: number) => void
}

function Fader({ value, onChange }: FaderProps) {
  return (
    <div className="flex items-center justify-center w-full py-1">
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{
          writingMode: 'vertical-lr',
          direction: 'rtl',
          height: 64,
          width: 18,
          cursor: 'pointer',
          accentColor: COLOR.accent.start,
        } as React.CSSProperties}
      />
    </div>
  )
}

// ── dB readout ─────────────────────────────────────────────────────────────

function DbReadout({ db }: { db: number }) {
  const display = db <= DB_MIN + 1 ? '-∞' : `${db.toFixed(0)}`
  const color = db >= DB_CLIP    ? COLOR.meter.clip
              : db >= DB_CAUTION ? COLOR.meter.caution
              : COLOR.text.muted
  return (
    <span style={{ fontSize: 8, color, fontVariantNumeric: 'tabular-nums', minWidth: 22, textAlign: 'center' }}>
      {display}
    </span>
  )
}

// ── Source connect button ──────────────────────────────────────────────────

function SourceButton({
  id, label, connected, connecting, error, onClick,
}: {
  id: string
  label: string
  connected: boolean
  connecting: boolean
  error?: string
  onClick: (id: string) => void
}) {
  return (
    <button
      onClick={() => onClick(id)}
      disabled={connecting}
      title={
        error ??
        (connected
          ? `${label} connected — click to disconnect`
          : `Connect ${label.toLowerCase()} audio`)
      }
      style={{
        height: 16,
        padding: '0 6px',
        borderRadius: 4,
        fontSize: 9,
        fontWeight: 600,
        cursor: connecting ? 'default' : 'pointer',
        border: 'none',
        background: error
          ? COLOR.meter.clip
          : connected
            ? COLOR.meter.safe
            : COLOR.bg.base,
        color: connected || error ? '#fff' : COLOR.text.muted,
        opacity: connecting ? 0.5 : 1,
        transition: 'background 0.1s',
      }}
    >
      {connecting ? '…' : label}
    </button>
  )
}

// ── Channel strip ──────────────────────────────────────────────────────────

interface ChannelStripProps {
  channel:   AudioChannel
  connected: boolean
  onVolume:  (id: string, v: number) => void
  onMute:    (id: string, muted: boolean) => void
  onNS:      (id: string, enabled: boolean) => void
}

function ChannelStrip({ channel, connected, onVolume, onMute, onNS }: ChannelStripProps) {
  const { id, name, volume, muted, noiseSuppression, levels } = channel
  const { peakL, peakR, rmsL, rmsR } = levels

  // Peak hold: retain peak for 1.5 s then decay
  const holdL = useRef(peakL)
  const holdR = useRef(peakR)
  const timerL = useRef<ReturnType<typeof setTimeout> | null>(null)
  const timerR = useRef<ReturnType<typeof setTimeout> | null>(null)

  if (peakL > holdL.current) {
    holdL.current = peakL
    if (timerL.current) clearTimeout(timerL.current)
    timerL.current = setTimeout(() => { holdL.current = peakL }, 1500)
  }
  if (peakR > holdR.current) {
    holdR.current = peakR
    if (timerR.current) clearTimeout(timerR.current)
    timerR.current = setTimeout(() => { holdR.current = peakR }, 1500)
  }

  const peakDb = Math.max(rmsL, rmsR)

  return (
    <div
      className="flex flex-col items-center gap-1 min-w-[52px] max-w-[60px] h-full rounded-button p-2"
      style={{ background: COLOR.bg.panel, flex: '1 0 52px' }}
    >
      {/* VU meter */}
      <StereoMeter
        peakL={holdL.current}
        peakR={holdR.current}
        rmsL={rmsL}
        rmsR={rmsR}
      />

      {/* dB readout */}
      <DbReadout db={peakDb} />

      {/* Fader */}
      <Fader value={volume} onChange={(v) => onVolume(id, v)} />

      {/* Mute button */}
      <button
        onClick={() => onMute(id, !muted)}
        title="Mute"
        style={{
          width: 28,
          height: 20,
          borderRadius: 4,
          fontSize: 10,
          fontWeight: 600,
          cursor: 'pointer',
          border: 'none',
          background: muted ? COLOR.meter.clip : COLOR.bg.base,
          color:      muted ? '#fff'            : COLOR.text.muted,
          transition: 'background 0.1s',
        }}
      >
        M
      </button>

      {/* Noise Suppression button */}
      <button
        onClick={() => onNS(id, !noiseSuppression)}
        title={noiseSuppression ? 'Noise suppression ON (click to disable)' : 'Noise suppression OFF (click to enable)'}
        style={{
          width: 28,
          height: 20,
          borderRadius: 4,
          fontSize: 9,
          fontWeight: 700,
          cursor: 'pointer',
          border: 'none',
          background: noiseSuppression ? COLOR.accent.start : COLOR.bg.base,
          color:      noiseSuppression ? '#fff' : COLOR.text.muted,
          transition: 'background 0.1s',
          letterSpacing: '-0.5px',
        }}
      >
        NS
      </button>

      {/* Label — dimmed when nothing is feeding this channel */}
      <span
        style={{
          fontSize: 9,
          color: COLOR.text.muted,
          opacity: connected ? 1 : 0.45,
          textAlign: 'center',
          maxWidth: '100%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {name}
      </span>
    </div>
  )
}

// ── Panel ──────────────────────────────────────────────────────────────────

export function AudioMixerPanel() {
  const channels           = useAudioStore((s) => s.channels)
  const connected          = useAudioStore((s) => s.connected)
  const errors             = useAudioStore((s) => s.errors)
  const setConnected       = useAudioStore((s) => s.setConnected)
  const setChannelError    = useAudioStore((s) => s.setChannelError)
  const engineRef          = useRef<AudioEngine | null>(null)
  const [connecting, setConnecting] = useState<string | null>(null)
  const setVolume          = useAudioStore((s) => s.setVolume)
  const setMuted           = useAudioStore((s) => s.setMuted)
  const setNoiseSuppression = useAudioStore((s) => s.setNoiseSuppression)

  // Levels are measured here from the real streams rather than pushed by the
  // backend. The engine reads gain and mute straight from the store so a fader
  // move is reflected on the next frame without re-creating it.
  useEffect(() => {
    const engine = new AudioEngine({
      gainOf:  (id) => useAudioStore.getState().channels.find((c) => c.id === id)?.volume ?? 1,
      mutedOf: (id) => useAudioStore.getState().channels.find((c) => c.id === id)?.muted ?? false,
      onLevels: (levels) => useAudioStore.getState().setAllLevels(levels),
    })

    engineRef.current = engine
    engine.start()

    return () => {
      engineRef.current = null
      void engine.dispose()
    }
  }, [])

  const handleVolume = useCallback((id: string, volume: number) => {
    setVolume(id, volume)
  }, [setVolume])

  const handleMute = useCallback((id: string, muted: boolean) => {
    setMuted(id, muted)
  }, [setMuted])

  /** Only these two have a real source available on Windows. */
  const CONNECTABLE: Record<string, () => Promise<MediaStream>> = {
    mic:     requestMicrophone,
    desktop: requestDesktopAudio,
  }

  const handleConnect = useCallback(async (id: string) => {
    const engine = engineRef.current
    if (!engine) return

    if (connected.includes(id)) {
      engine.detach(id as ChannelId)
      setConnected(id, false)
      return
    }

    const request = CONNECTABLE[id]
    if (!request) return

    setConnecting(id)
    setChannelError(id, null)
    try {
      engine.attach(id as ChannelId, await request())
      setConnected(id, true)
    } catch (err) {
      setChannelError(id, err instanceof Error ? err.message : String(err))
    } finally {
      setConnecting(null)
    }
    // CONNECTABLE is rebuilt each render but its functions are module-level.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, setConnected, setChannelError])

  const handleNS = useCallback((id: string, enabled: boolean) => {
    setNoiseSuppression(id, enabled)
  }, [setNoiseSuppression])

  return (
    <div className="flex flex-col h-full bg-bg-surface overflow-hidden">
      <div className="panel-header">
        <span className="panel-header-title">Audio Mixer</span>

        {/* Source connection lives here rather than in the strips: only two of
            the four channels can connect, and the strips have no spare height. */}
        <div className="flex items-center gap-1.5 ml-auto">
          {Object.keys(CONNECTABLE).map((id) => (
            <SourceButton
              key={id}
              id={id}
              label={id === 'mic' ? 'Mic' : 'Desktop'}
              connected={connected.includes(id)}
              connecting={connecting === id}
              error={errors[id]}
              onClick={handleConnect}
            />
          ))}
        </div>
      </div>

      {Object.entries(errors).length > 0 && (
        <p className="text-[10px] text-state-danger px-2 pb-1 leading-tight">
          {Object.values(errors)[0]}
        </p>
      )}

      <div className="flex-1 flex overflow-x-auto overflow-y-hidden p-2 gap-2">
        {channels.map((ch) => (
          <ChannelStrip
            key={ch.id}
            channel={ch}
            connected={connected.includes(ch.id)}
            onVolume={handleVolume}
            onMute={handleMute}
            onNS={handleNS}
          />
        ))}
      </div>
    </div>
  )
}
