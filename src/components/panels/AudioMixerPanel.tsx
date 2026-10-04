import { useEffect, useRef, useCallback, useState } from 'react'
import { useAudioStore, rememberInput, rememberedInputs, type AudioChannel } from '@/stores/audioStore'
import {
  AudioEngine, requestMicrophone, requestDesktopAudio, type ChannelId,
} from '@/lib/audio/engine'
import { decayPeak, FLOOR_DB } from '@/lib/audio/levels'
import { COLOR } from '@/lib/tokens'

/**
 * The audio mixer: one vertical strip per channel.
 *
 * The strip is ordered name-first and the meter takes whatever height is
 * left. Previously the name sat at the bottom of a fixed stack of six
 * elements, so in a short dock it was pushed out of view along with part of
 * the noise-suppression button — the two controls that say what a strip is
 * and what it is doing. Mute and noise suppression now share one line, which
 * gives the meter back a row of height.
 */

// ── dB scale ───────────────────────────────────────────────────────────────

const DB_MIN = FLOOR_DB
const DB_MAX = 0
const DB_CLIP = -6
const DB_CAUTION = -20

/** How fast a held peak falls once the signal drops below it. */
const PEAK_DECAY_DB_PER_SEC = 20

const SEGMENTS = 20

function dbToFrac(db: number): number {
  return Math.max(0, Math.min(1, (db - DB_MIN) / (DB_MAX - DB_MIN)))
}

function meterColor(db: number): string {
  if (db >= DB_CLIP) return COLOR.meter.clip
  if (db >= DB_CAUTION) return COLOR.meter.caution
  return COLOR.meter.safe
}

/**
 * Holds the loudest recent peak and lets it fall back.
 *
 * The previous implementation mutated a ref during render and scheduled a
 * timer that reassigned the same captured value, so the hold only ever rose:
 * one loud moment pinned the marker for the rest of the session. Levels
 * arrive once per animation frame, so decaying against elapsed wall time here
 * needs no timer of its own and nothing to clean up.
 */
function usePeakHold(peak: number): number {
  const [held, setHeld] = useState(peak)
  const last = useRef({ value: peak, at: 0 })

  useEffect(() => {
    const now = performance.now()
    const elapsed = last.current.at === 0 ? 0 : now - last.current.at
    const next = decayPeak(last.current.value, peak, PEAK_DECAY_DB_PER_SEC, elapsed)
    last.current = { value: next, at: now }
    setHeld(next)
  }, [peak])

  return held
}

// ── Vertical meter ─────────────────────────────────────────────────────────

/** One channel of the stereo pair, filling from the bottom up. */
function MeterBar({ rms, peak }: { rms: number; peak: number }) {
  const rmsF = dbToFrac(rms)
  const peakF = dbToFrac(peak)
  const showPeak = peak > DB_MIN + 1

  return (
    <div
      className="relative flex-1 h-full overflow-hidden rounded-[2px]"
      style={{ minWidth: 5, background: COLOR.bg.base }}
    >
      {/* Segments, so the meter reads as a ladder rather than a smooth bar. */}
      <div className="absolute inset-0 flex flex-col-reverse">
        {Array.from({ length: SEGMENTS }, (_, i) => {
          const segFrac = (i + 1) / SEGMENTS
          const segDb = DB_MIN + segFrac * (DB_MAX - DB_MIN)
          const lit = rmsF >= segFrac
          return (
            <div
              key={i}
              style={{
                flex: 1,
                marginTop: 1,
                background: lit ? meterColor(segDb) : COLOR.text.muted,
                opacity: lit ? 1 : 0.13,
                transition: 'opacity 60ms linear',
              }}
            />
          )
        })}
      </div>

      {/* Where the signal starts clipping. */}
      <div
        className="absolute inset-x-0"
        style={{
          bottom: `${dbToFrac(DB_CLIP) * 100}%`,
          height: 1,
          background: COLOR.text.muted,
          opacity: 0.45,
        }}
      />

      {showPeak && (
        <div
          className="absolute inset-x-0"
          style={{
            bottom: `calc(${peakF * 100}% - 1px)`,
            height: 2,
            background: meterColor(peak),
            transition: 'bottom 80ms linear',
          }}
        />
      )}
    </div>
  )
}

function StereoMeter({ peakL, peakR, rmsL, rmsR }: {
  peakL: number; peakR: number; rmsL: number; rmsR: number
}) {
  return (
    <div className="h-full flex gap-[2px]" style={{ width: 16 }}>
      <MeterBar rms={rmsL} peak={peakL} />
      <MeterBar rms={rmsR} peak={peakR} />
    </div>
  )
}

// ── Readout ────────────────────────────────────────────────────────────────

function DbReadout({ db }: { db: number }) {
  const display = db <= DB_MIN + 1 ? '−∞' : db.toFixed(1)
  const color =
    db >= DB_CLIP ? COLOR.meter.clip : db >= DB_CAUTION ? COLOR.meter.caution : COLOR.text.secondary

  return (
    <span
      style={{
        fontSize: 9,
        color,
        fontVariantNumeric: 'tabular-nums',
        lineHeight: '11px',
      }}
    >
      {display}
    </span>
  )
}

// ── Small toggle ───────────────────────────────────────────────────────────

function Toggle({
  on, onClick, label, title, activeColor,
}: {
  on: boolean
  onClick: () => void
  label: string
  title: string
  activeColor: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={on}
      style={{
        flex: 1,
        minWidth: 0,
        height: 18,
        borderRadius: 3,
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '-0.2px',
        cursor: 'pointer',
        border: `1px solid ${on ? activeColor : COLOR.bg.divider}`,
        background: on ? activeColor : 'transparent',
        color: on ? '#fff' : COLOR.text.muted,
        transition: 'background 0.12s, border-color 0.12s, color 0.12s',
      }}
    >
      {label}
    </button>
  )
}

// ── Fader ──────────────────────────────────────────────────────────────────

function Fader({ value, onChange, name }: {
  value: number
  onChange: (v: number) => void
  name: string
}) {
  return (
    <input
      type="range"
      min={0}
      max={1}
      step={0.01}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      aria-label={`${name} volume`}
      title={`${Math.round(value * 100)}%`}
      style={{
        writingMode: 'vertical-lr',
        direction: 'rtl',
        height: '100%',
        width: 16,
        flexShrink: 0,
        cursor: 'pointer',
        accentColor: COLOR.accent.start,
      } as React.CSSProperties}
    />
  )
}

// ── One channel strip ──────────────────────────────────────────────────────

interface ChannelStripProps {
  channel: AudioChannel
  connected: boolean
  onVolume: (id: string, v: number) => void
  onMute: (id: string, muted: boolean) => void
  onNS: (id: string, enabled: boolean) => void
}

function ChannelStrip({ channel, connected, onVolume, onMute, onNS }: ChannelStripProps) {
  const { id, name, volume, muted, noiseSuppression, levels } = channel
  const { peakL, peakR, rmsL, rmsR } = levels

  const holdL = usePeakHold(peakL)
  const holdR = usePeakHold(peakR)

  const loudest = Math.max(rmsL, rmsR)

  return (
    <div
      className="flex flex-col items-center gap-1 h-full rounded-button px-1.5 py-1.5"
      style={{
        flex: '1 0 64px',
        minWidth: 64,
        maxWidth: 88,
        background: COLOR.bg.panel,
        border: `1px solid ${COLOR.bg.divider}`,
        opacity: muted ? 0.65 : 1,
        transition: 'opacity 0.12s',
      }}
    >
      {/* Name first, so a short panel can never push it out of view. */}
      <div className="flex items-center gap-1 w-full min-w-0">
        <span
          className="flex-shrink-0 rounded-full"
          style={{
            width: 4,
            height: 4,
            background: connected ? COLOR.meter.safe : COLOR.text.muted,
            opacity: connected ? 1 : 0.4,
          }}
          title={connected ? 'Receiving audio' : 'No source connected'}
        />
        <span
          className="flex-1 truncate text-center"
          style={{
            fontSize: 9.5,
            fontWeight: 600,
            color: muted ? COLOR.text.muted : COLOR.text.primary,
            textDecoration: muted ? 'line-through' : 'none',
          }}
          title={name}
        >
          {name}
        </span>
      </div>

      <DbReadout db={loudest} />

      {/* Fader and meter share the strip's remaining height side by side.
          Stacked, both wanted the same scarce space and the meter collapsed
          to zero in a short dock. */}
      <div className="flex-1 w-full flex items-stretch justify-center gap-1.5 min-h-0">
        <Fader value={volume} onChange={(v) => onVolume(id, v)} name={name} />
        <StereoMeter peakL={holdL} peakR={holdR} rmsL={rmsL} rmsR={rmsR} />
      </div>

      {/* Mute and noise suppression share a line; stacked, they cost the
          meter a whole row of height in a dock this short. */}
      <div className="flex gap-1 w-full">
        <Toggle
          on={muted}
          onClick={() => onMute(id, !muted)}
          label="M"
          title={muted ? `Unmute ${name}` : `Mute ${name}`}
          activeColor={COLOR.meter.clip}
        />
        <Toggle
          on={noiseSuppression}
          onClick={() => onNS(id, !noiseSuppression)}
          label="NS"
          title={
            noiseSuppression
              ? `Noise suppression on for ${name}`
              : `Noise suppression off for ${name}`
          }
          activeColor={COLOR.accent.start}
        />
      </div>
    </div>
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
      type="button"
      onClick={() => onClick(id)}
      disabled={connecting}
      aria-pressed={connected}
      title={
        error ??
        (connected ? `${label} connected — click to disconnect` : `Connect ${label.toLowerCase()} audio`)
      }
      style={{
        height: 18,
        padding: '0 8px',
        borderRadius: 4,
        fontSize: 9,
        fontWeight: 600,
        cursor: connecting ? 'default' : 'pointer',
        border: `1px solid ${error ? COLOR.meter.clip : connected ? COLOR.meter.safe : COLOR.bg.divider}`,
        background: error ? COLOR.meter.clip : connected ? COLOR.meter.safe : 'transparent',
        color: connected || error ? '#fff' : COLOR.text.muted,
        opacity: connecting ? 0.5 : 1,
        transition: 'background 0.12s, border-color 0.12s',
      }}
    >
      {connecting ? '…' : label}
    </button>
  )
}

// ── Panel ──────────────────────────────────────────────────────────────────

/** Only these two have a real source available on Windows. */
const CONNECTABLE: Record<string, (deviceId: string) => Promise<MediaStream>> = {
  mic: (deviceId) => requestMicrophone(deviceId || undefined),
  // Everything the computer plays is captured; there is no single device to choose.
  desktop: () => requestDesktopAudio(),
}

export function AudioMixerPanel() {
  const channels = useAudioStore((s) => s.channels)
  const connected = useAudioStore((s) => s.connected)
  const errors = useAudioStore((s) => s.errors)
  const setConnected = useAudioStore((s) => s.setConnected)
  const setChannelError = useAudioStore((s) => s.setChannelError)
  const engineRef = useRef<AudioEngine | null>(null)
  const [connecting, setConnecting] = useState<string | null>(null)
  const setVolume = useAudioStore((s) => s.setVolume)
  const setMuted = useAudioStore((s) => s.setMuted)
  const setNoiseSuppression = useAudioStore((s) => s.setNoiseSuppression)

  // Levels are measured here from the real streams rather than pushed by the
  // backend. The engine reads gain and mute straight from the store so a fader
  // move is reflected on the next frame without re-creating it.
  useEffect(() => {
    const engine = new AudioEngine({
      gainOf: (id) => useAudioStore.getState().channels.find((c) => c.id === id)?.volume ?? 1,
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

  const handleNS = useCallback((id: string, enabled: boolean) => {
    setNoiseSuppression(id, enabled)
  }, [setNoiseSuppression])

  const connect = useCallback(async (id: string) => {
    const request = CONNECTABLE[id]
    if (!engineRef.current || !request) return

    setConnecting(id)
    setChannelError(id, null)
    try {
      const stream = await request(useAudioStore.getState().devices[id] ?? '')
      // The panel may have gone while the input was opening; its engine with it.
      const engine = engineRef.current
      if (!engine) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      engine.attach(id as ChannelId, stream)
      setConnected(id, true)
    } catch (err) {
      setChannelError(id, err instanceof Error ? err.message : String(err))
    } finally {
      setConnecting(null)
    }
  }, [setConnected, setChannelError])

  const handleConnect = useCallback(async (id: string) => {
    const engine = engineRef.current
    if (!engine) return

    if (connected.includes(id)) {
      engine.detach(id as ChannelId)
      setConnected(id, false)
      rememberInput(id, false)
      return
    }

    rememberInput(id, true)
    await connect(id)
  }, [connected, connect, setConnected])

  // Choosing another microphone in Settings switches the connected one over to it.
  const micDevice = useAudioStore((s) => s.devices.mic ?? '')
  const lastMic = useRef(micDevice)
  useEffect(() => {
    if (lastMic.current === micDevice) return
    lastMic.current = micDevice
    if (useAudioStore.getState().connected.includes('mic')) void connect('mic')
  }, [micDevice, connect])

  // Reconnect what was connected last time. This runs whenever the panel opens,
  // not once per launch: closing the panel disposes its engine, and the inputs
  // it held would otherwise still read as connected with nothing behind them.
  // A failure (the microphone is gone, access was denied) shows on the button.
  useEffect(() => {
    void (async () => {
      for (const id of rememberedInputs()) {
        if (id in CONNECTABLE) await connect(id)
      }
    })()
  }, [connect])

  const firstError = Object.values(errors).find(Boolean)

  return (
    <div className="flex flex-col h-full bg-bg-surface overflow-hidden">
      <div className="panel-header">
        <span className="panel-header-title">Audio Mixer</span>

        {/* Source connection lives here rather than in the strips: only two of
            the four channels can connect to anything. */}
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

      {firstError && (
        <p className="text-[10px] text-state-danger px-2.5 pb-1 leading-tight">{firstError}</p>
      )}

      <div className="flex-1 flex overflow-x-auto overflow-y-hidden p-2 gap-2 min-h-0">
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
