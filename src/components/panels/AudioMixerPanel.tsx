import { useEffect, useRef, useCallback } from 'react'
import { ipc, onAudioLevels } from '@/ipc'
import { useAudioStore, type AudioChannel } from '@/stores/audioStore'
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

// ── Channel strip ──────────────────────────────────────────────────────────

interface ChannelStripProps {
  channel:  AudioChannel
  onVolume: (id: string, v: number) => void
  onMute:   (id: string, muted: boolean) => void
  onNS:     (id: string, enabled: boolean) => void
}

function ChannelStrip({ channel, onVolume, onMute, onNS }: ChannelStripProps) {
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

      {/* Label */}
      <span style={{ fontSize: 9, color: COLOR.text.muted, textAlign: 'center', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {name}
      </span>
    </div>
  )
}

// ── Panel ──────────────────────────────────────────────────────────────────

export function AudioMixerPanel() {
  const channels           = useAudioStore((s) => s.channels)
  const setVolume          = useAudioStore((s) => s.setVolume)
  const setMuted           = useAudioStore((s) => s.setMuted)
  const setNoiseSuppression = useAudioStore((s) => s.setNoiseSuppression)
  const updateLevels       = useAudioStore((s) => s.updateLevels)

  // Wire up Tauri audio levels event
  useEffect(() => {
    let unlisten: (() => void) | null = null
    async function setup() {
      try { await ipc.audio.start() } catch { /* browser dev — no-op */ }
      unlisten = await onAudioLevels((levels) => {
        levels.forEach(({ id, peakL, peakR, rmsL, rmsR }) => {
          updateLevels(id, { peakL, peakR, rmsL, rmsR })
        })
      })
    }
    setup()
    return () => { unlisten?.(); ipc.audio.stop().catch(() => {}) }
  }, [updateLevels])

  const handleVolume = useCallback((id: string, volume: number) => {
    setVolume(id, volume)
    ipc.audio.setVolume(id, volume).catch(() => {})
  }, [setVolume])

  const handleMute = useCallback((id: string, muted: boolean) => {
    setMuted(id, muted)
    ipc.audio.setMuted(id, muted).catch(() => {})
  }, [setMuted])

  const handleNS = useCallback((id: string, enabled: boolean) => {
    setNoiseSuppression(id, enabled)
  }, [setNoiseSuppression])

  return (
    <div className="flex flex-col h-full bg-bg-surface overflow-hidden">
      <div className="panel-header">
        <span className="panel-header-title">Audio Mixer</span>
      </div>

      <div className="flex-1 flex overflow-x-auto overflow-y-hidden p-2 gap-2">
        {channels.map((ch) => (
          <ChannelStrip
            key={ch.id}
            channel={ch}
            onVolume={handleVolume}
            onMute={handleMute}
            onNS={handleNS}
          />
        ))}
      </div>
    </div>
  )
}
