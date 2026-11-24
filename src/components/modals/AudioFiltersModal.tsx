import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { useUIStore } from '@/stores/uiStore'
import { useAudioStore } from '@/stores/audioStore'
import { DEFAULT_FILTERS, LIMITS, parseFilters, type AudioFilters } from '../../../shared/audioFilters'
import { cn } from '@/lib/utils'

/**
 * Gain, noise gate and compressor for one mixer channel. Changes apply as they
 * are made, so the person can hear them in a test recording; Reset puts the
 * channel back to no filters.
 */

export interface AudioFiltersPayload { channelId: string }

export function AudioFiltersModal() {
  const { modal, closeModal } = useUIStore((s) => ({ modal: s.modal, closeModal: s.closeModal }))
  const open = modal?.type === 'audio-filters'
  const channelId = open ? (modal?.payload as AudioFiltersPayload | undefined)?.channelId : undefined
  const channel = useAudioStore((s) => s.channels.find((c) => c.id === channelId))
  const setFilters = useAudioStore((s) => s.setFilters)

  const [f, setF] = useState<AudioFilters>(DEFAULT_FILTERS)
  useEffect(() => { if (channel) setF(parseFilters(channel.filters)) }, [open, channelId]) // eslint-disable-line react-hooks/exhaustive-deps

  const change = (next: AudioFilters) => {
    const clean = parseFilters(next)
    setF(clean)
    if (channelId) setFilters(channelId, clean)
  }
  const gate = (patch: Partial<AudioFilters['gate']>) => change({ ...f, gate: { ...f.gate, ...patch } })
  const comp = (patch: Partial<AudioFilters['compressor']>) => change({ ...f, compressor: { ...f.compressor, ...patch } })

  return (
    <Dialog.Root open={open && !!channel} onOpenChange={(o) => !o && closeModal()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-[60] animate-fade-in" />
        <Dialog.Content
          className={cn(
            'fixed z-[60] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2',
            'w-[440px] max-h-[90vh] overflow-y-auto bg-bg-panel border border-bg-divider rounded-panel shadow-modal',
            'flex flex-col animate-fade-in',
          )}
        >
          <div className="flex items-center justify-between px-5 py-3 border-b border-bg-divider">
            <Dialog.Title className="text-body font-semibold text-text-primary">
              Audio Filters: {channel?.name}
            </Dialog.Title>
            <button onClick={closeModal} className="icon-btn" aria-label="Close"><X size={14} /></button>
          </div>

          <Dialog.Description className="px-5 pt-3 text-caption text-text-muted leading-relaxed">
            Applied to what is recorded and streamed, in this order. Changes take effect straight away.
            The meter in the mixer shows the sound before these filters.
          </Dialog.Description>

          <div className="px-5 py-4 flex flex-col gap-5">
            <Section title="Gain">
              <Slider label="Gain" unit="dB" value={f.gainDb} range={LIMITS.gainDb} step={0.5}
                onChange={(v) => change({ ...f, gainDb: v })} />
              <Hint>Makes a quiet microphone louder, or a loud one quieter.</Hint>
            </Section>

            <Section title="Noise Gate" enabled={f.gate.enabled} onToggle={(on) => gate({ enabled: on })}>
              <Slider label="Open above" unit="dB" value={f.gate.openDb} range={LIMITS.gateDb} step={1}
                disabled={!f.gate.enabled} onChange={(v) => gate({ openDb: v, closeDb: Math.min(f.gate.closeDb, v) })} />
              <Slider label="Close below" unit="dB" value={f.gate.closeDb} range={LIMITS.gateDb} step={1}
                disabled={!f.gate.enabled} onChange={(v) => gate({ closeDb: Math.min(v, f.gate.openDb) })} />
              <Slider label="Hold" unit="ms" value={f.gate.holdMs} range={LIMITS.holdMs} step={10}
                disabled={!f.gate.enabled} onChange={(v) => gate({ holdMs: v })} />
              <Hint>Silences the microphone between words, so keyboard and fan noise are not heard.</Hint>
            </Section>

            <Section title="Compressor" enabled={f.compressor.enabled} onToggle={(on) => comp({ enabled: on })}>
              <Slider label="Threshold" unit="dB" value={f.compressor.thresholdDb} range={LIMITS.thresholdDb} step={1}
                disabled={!f.compressor.enabled} onChange={(v) => comp({ thresholdDb: v })} />
              <Slider label="Ratio" unit=":1" value={f.compressor.ratio} range={LIMITS.ratio} step={0.5}
                disabled={!f.compressor.enabled} onChange={(v) => comp({ ratio: v })} />
              <Slider label="Attack" unit="ms" value={f.compressor.attackMs} range={[1, 100]} step={1}
                disabled={!f.compressor.enabled} onChange={(v) => comp({ attackMs: v })} />
              <Slider label="Release" unit="ms" value={f.compressor.releaseMs} range={[10, 1000]} step={10}
                disabled={!f.compressor.enabled} onChange={(v) => comp({ releaseMs: v })} />
              <Slider label="Output gain" unit="dB" value={f.compressor.makeupDb} range={LIMITS.makeupDb} step={0.5}
                disabled={!f.compressor.enabled} onChange={(v) => comp({ makeupDb: v })} />
              <Hint>Evens out loud and quiet speech, so shouting does not distort and quiet words are heard.</Hint>
            </Section>
          </div>

          <div className="flex justify-between gap-2 px-5 py-3 border-t border-bg-divider">
            <button
              onClick={() => change(DEFAULT_FILTERS)}
              className="h-7 px-3 rounded-button text-caption text-text-muted hover:text-text-primary hover:bg-state-hover transition-colors"
            >
              Reset
            </button>
            <button
              onClick={closeModal}
              className="h-7 px-5 rounded-button text-caption font-semibold text-white bg-accent-gradient hover:opacity-90"
            >
              Done
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Section({ title, enabled, onToggle, children }: {
  title: string
  enabled?: boolean
  onToggle?: (on: boolean) => void
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-caption font-semibold text-text-muted uppercase tracking-wider">{title}</h3>
        {onToggle && (
          <label className="flex items-center gap-2 text-caption text-text-secondary cursor-pointer">
            <input type="checkbox" checked={!!enabled} onChange={(e) => onToggle(e.target.checked)} aria-label={`${title} on`} />
            On
          </label>
        )}
      </div>
      {children}
    </section>
  )
}

function Slider({ label, unit, value, range, step, disabled, onChange }: {
  label: string
  unit: string
  value: number
  range: readonly [number, number]
  step: number
  disabled?: boolean
  onChange: (v: number) => void
}) {
  const shown = Number.isInteger(step) ? Math.round(value) : value.toFixed(1)
  return (
    <label className={cn('flex items-center gap-3 text-caption', disabled ? 'opacity-40' : 'text-text-secondary')}>
      <span className="w-24 flex-shrink-0">{label}</span>
      <input
        type="range"
        min={range[0]}
        max={range[1]}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-accent-start"
      />
      <span className="w-16 text-right text-text-primary tabular-nums">{shown} {unit}</span>
    </label>
  )
}

const Hint = ({ children }: { children: React.ReactNode }) => (
  <p className="text-[11px] text-text-muted leading-relaxed">{children}</p>
)
