import { useState, useEffect, useCallback } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/uiStore'
import {
  useSettingsStore,
  DEFAULT_GENERAL, DEFAULT_VIDEO, DEFAULT_AUDIO,
  STANDARD_RESOLUTIONS, FRAME_RATES,
  type SettingsState,
} from '@/stores/settingsStore'
import {
  useHotkeyStore,
  formatBinding, keyEventToBinding,
} from '@/stores/hotkeyStore'
import type { GeneralSettings, VideoSettings } from '@/types/settings'
import type { AudioSettings } from '@/types/audio'
import type { KeyBinding } from '@/types/hotkey'

// ── Primitives ──────────────────────────────────────────────────────────────

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-2.5 border-b border-bg-divider/40 last:border-0">
      <span className="text-body text-text-secondary flex-shrink-0 w-52">{label}</span>
      <div className="flex-1 flex justify-end">{children}</div>
    </div>
  )
}

function Sel<T extends string | number>({
  value, onChange, options,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="h-7 px-2 min-w-[160px] rounded-input bg-bg-surface border border-bg-divider
                 text-body text-text-primary focus:outline-none focus:border-accent-start cursor-pointer"
    >
      {options.map((o) => (
        <option key={String(o.value)} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={cn(
        'w-9 h-5 rounded-full relative transition-colors flex-shrink-0',
        value ? 'bg-accent-start' : 'bg-bg-panel border border-bg-divider'
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform shadow-sm',
          value ? 'translate-x-4' : 'translate-x-0.5'
        )}
      />
    </button>
  )
}

function SectionHeader({ title }: { title: string }) {
  return (
    <h3 className="text-caption font-semibold text-text-muted uppercase tracking-wider pt-4 pb-1 first:pt-0">
      {title}
    </h3>
  )
}

// ── Tab: General ────────────────────────────────────────────────────────────

function GeneralTab({
  draft, set,
}: {
  draft: GeneralSettings
  set: (patch: Partial<GeneralSettings>) => void
}) {
  return (
    <div>
      <SectionHeader title="Application" />
      <Row label="Language">
        <Sel
          value={draft.language}
          onChange={(v) => set({ language: v })}
          options={[
            { value: 'en-US', label: 'English (US)' },
            { value: 'en-GB', label: 'English (UK)' },
            { value: 'ja-JP', label: '日本語' },
            { value: 'ko-KR', label: '한국어' },
            { value: 'zh-CN', label: '中文 (简体)' },
          ]}
        />
      </Row>
      <Row label="Update channel">
        <Sel
          value={draft.updateChannel}
          onChange={(v) => set({ updateChannel: v as 'stable' | 'beta' })}
          options={[
            { value: 'stable', label: 'Stable' },
            { value: 'beta',   label: 'Beta' },
          ]}
        />
      </Row>
      <Row label="Auto-check for updates">
        <Toggle value={draft.autoCheckUpdates} onChange={(v) => set({ autoCheckUpdates: v })} />
      </Row>

      <SectionHeader title="Behaviour" />
      <Row label="Minimize to system tray">
        <Toggle value={draft.systemTray} onChange={(v) => set({ systemTray: v })} />
      </Row>
      <Row label="Confirm on exit">
        <Toggle value={draft.confirmOnExit} onChange={(v) => set({ confirmOnExit: v })} />
      </Row>
    </div>
  )
}

// ── Tab: Video ──────────────────────────────────────────────────────────────

const resolutionOptions = STANDARD_RESOLUTIONS.map((r) => ({
  value: r.label,
  label: r.label,
}))

function VideoTab({
  draft, set,
}: {
  draft: VideoSettings
  set: (patch: Partial<VideoSettings>) => void
}) {
  return (
    <div>
      <SectionHeader title="Canvas" />
      <Row label="Base (Canvas) Resolution">
        <Sel
          value={draft.baseResolution.label}
          onChange={(label) => {
            const r = STANDARD_RESOLUTIONS.find((x) => x.label === label)
            if (r) set({ baseResolution: r })
          }}
          options={resolutionOptions}
        />
      </Row>
      <Row label="Output (Scaled) Resolution">
        <Sel
          value={draft.outputResolution.label}
          onChange={(label) => {
            const r = STANDARD_RESOLUTIONS.find((x) => x.label === label)
            if (r) set({ outputResolution: r })
          }}
          options={resolutionOptions}
        />
      </Row>
      <Row label="Common FPS Values">
        <Sel
          value={draft.fps}
          onChange={(v) => set({ fps: Number(v) as typeof draft.fps, fpsNumerator: Number(v), fpsDenominator: 1 })}
          options={FRAME_RATES.map((f) => ({ value: f, label: `${f} FPS` }))}
        />
      </Row>

      <SectionHeader title="Encoder" />
      <Row label="Downscale Filter">
        <Sel
          value={draft.downscaleFilter}
          onChange={(v) => set({ downscaleFilter: v as VideoSettings['downscaleFilter'] })}
          options={[
            { value: 'bilinear', label: 'Bilinear' },
            { value: 'area',     label: 'Area' },
            { value: 'bicubic',  label: 'Bicubic (Recommended)' },
            { value: 'lanczos',  label: 'Lanczos' },
          ]}
        />
      </Row>
      <Row label="Color Format">
        <Sel
          value={draft.colorFormat}
          onChange={(v) => set({ colorFormat: v as VideoSettings['colorFormat'] })}
          options={[
            { value: 'NV12', label: 'NV12' },
            { value: 'I420', label: 'I420' },
            { value: 'I444', label: 'I444' },
            { value: 'RGB',  label: 'RGB' },
          ]}
        />
      </Row>
      <Row label="Color Space">
        <Sel
          value={draft.colorSpace}
          onChange={(v) => set({ colorSpace: v as VideoSettings['colorSpace'] })}
          options={[
            { value: '601',  label: 'Rec. 601' },
            { value: '709',  label: 'Rec. 709 (Recommended)' },
            { value: '2020', label: 'Rec. 2020' },
          ]}
        />
      </Row>
      <Row label="Color Range">
        <Sel
          value={draft.colorRange}
          onChange={(v) => set({ colorRange: v as VideoSettings['colorRange'] })}
          options={[
            { value: 'partial', label: 'Partial' },
            { value: 'full',    label: 'Full' },
          ]}
        />
      </Row>
      <Row label="GPU Conversion">
        <Toggle value={draft.gpuConversion} onChange={(v) => set({ gpuConversion: v })} />
      </Row>
    </div>
  )
}

// ── Tab: Audio ──────────────────────────────────────────────────────────────

const DEVICE_OPTIONS = [
  { value: 'default',  label: 'Default' },
  { value: 'disabled', label: 'Disabled' },
]

function AudioTab({
  draft, set,
}: {
  draft: AudioSettings
  set: (patch: Partial<AudioSettings>) => void
}) {
  return (
    <div>
      <SectionHeader title="Global Audio Devices" />
      <Row label="Desktop Audio">
        <Sel value={draft.desktopDevice1} onChange={(v) => set({ desktopDevice1: v })} options={DEVICE_OPTIONS} />
      </Row>
      <Row label="Desktop Audio 2">
        <Sel value={draft.desktopDevice2} onChange={(v) => set({ desktopDevice2: v })} options={DEVICE_OPTIONS} />
      </Row>
      <Row label="Mic / Auxiliary Audio">
        <Sel value={draft.auxDevice1} onChange={(v) => set({ auxDevice1: v })} options={DEVICE_OPTIONS} />
      </Row>
      <Row label="Mic / Auxiliary Audio 2">
        <Sel value={draft.auxDevice2} onChange={(v) => set({ auxDevice2: v })} options={DEVICE_OPTIONS} />
      </Row>
      <Row label="Mic / Auxiliary Audio 3">
        <Sel value={draft.auxDevice3} onChange={(v) => set({ auxDevice3: v })} options={DEVICE_OPTIONS} />
      </Row>

      <SectionHeader title="Advanced" />
      <Row label="Sample Rate">
        <Sel
          value={draft.sampleRate}
          onChange={(v) => set({ sampleRate: Number(v) as AudioSettings['sampleRate'] })}
          options={[
            { value: 44100,  label: '44.1 kHz' },
            { value: 48000,  label: '48 kHz (Recommended)' },
            { value: 192000, label: '192 kHz' },
          ]}
        />
      </Row>
      <Row label="Channels">
        <Sel
          value={draft.channels}
          onChange={(v) => set({ channels: Number(v) as AudioSettings['channels'] })}
          options={[
            { value: 1, label: 'Mono' },
            { value: 2, label: 'Stereo (Recommended)' },
          ]}
        />
      </Row>
    </div>
  )
}

// ── Tab: Hotkeys ────────────────────────────────────────────────────────────

function HotkeysTab() {
  const { hotkeys, recording, startRecording, stopRecording, setBinding, removeBinding } =
    useHotkeyStore()

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!recording) return
      e.preventDefault()
      if (e.key === 'Escape') { stopRecording(); return }
      const binding = keyEventToBinding(e)
      if (binding) { setBinding(recording, binding); stopRecording() }
    },
    [recording, stopRecording, setBinding]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  return (
    <div>
      <p className="text-caption text-text-muted mb-3">
        Click a binding to record a new shortcut. Press Escape to cancel.
      </p>
      <div className="flex flex-col gap-0.5">
        {hotkeys.map((hk) => {
          const isRecording = recording === hk.id
          return (
            <div
              key={hk.id}
              className="flex items-center justify-between gap-4 py-2 border-b border-bg-divider/40 last:border-0"
            >
              <span className="text-body text-text-secondary w-56 flex-shrink-0">{hk.description}</span>
              <div className="flex gap-1 items-center">
                {isRecording ? (
                  <span className="h-7 px-3 flex items-center rounded-input bg-accent-start/20 border border-accent-start text-caption text-accent-start animate-pulse">
                    Press keys…
                  </span>
                ) : hk.bindings.length > 0 ? (
                  hk.bindings.map((b, i) => (
                    <span key={i} className="flex items-center gap-1">
                      <button
                        onClick={() => startRecording(hk.id)}
                        className="h-7 px-3 rounded-input bg-bg-panel border border-bg-divider text-caption text-text-primary hover:border-accent-start hover:text-accent-start transition-colors"
                      >
                        {formatBinding(b)}
                      </button>
                      <button
                        onClick={() => removeBinding(hk.id, i)}
                        className="w-5 h-5 flex items-center justify-center text-text-muted hover:text-state-danger transition-colors"
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ))
                ) : (
                  <button
                    onClick={() => startRecording(hk.id)}
                    className="h-7 px-3 rounded-input border border-dashed border-bg-divider text-caption text-text-muted hover:border-accent-start hover:text-accent-start transition-colors"
                  >
                    — Not bound —
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Main modal ──────────────────────────────────────────────────────────────

type TabId = 'general' | 'video' | 'audio' | 'hotkeys'

const TABS: { id: TabId; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'video',   label: 'Video' },
  { id: 'audio',   label: 'Audio' },
  { id: 'hotkeys', label: 'Hotkeys' },
]

export function SettingsModal() {
  const { modal, closeModal } = useUIStore((s) => ({ modal: s.modal, closeModal: s.closeModal }))
  const { general, video, audio, applyAll } = useSettingsStore()
  const open = modal?.type === 'settings'

  const [activeTab, setActiveTab] = useState<TabId>('general')

  // Local draft — reset when modal opens
  const [draft, setDraft] = useState<SettingsState>({ general, video, audio })

  useEffect(() => {
    if (open) setDraft({ general, video, audio })
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  function patchGeneral(patch: Partial<GeneralSettings>) {
    setDraft((d) => ({ ...d, general: { ...d.general, ...patch } }))
  }
  function patchVideo(patch: Partial<VideoSettings>) {
    setDraft((d) => ({ ...d, video: { ...d.video, ...patch } }))
  }
  function patchAudio(patch: Partial<AudioSettings>) {
    setDraft((d) => ({ ...d, audio: { ...d.audio, ...patch } }))
  }

  function apply() { applyAll(draft) }
  function ok()    { apply(); closeModal() }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && closeModal()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/70 z-50 animate-fade-in" />
        <Dialog.Content
          className={cn(
            'fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2',
            'w-[820px] h-[580px] bg-bg-panel border border-bg-divider rounded-panel shadow-modal',
            'flex flex-col animate-fade-in overflow-hidden'
          )}
          onKeyDown={(e) => { if (e.key === 'Escape' && !useHotkeyStore.getState().recording) closeModal() }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-bg-divider flex-shrink-0">
            <Dialog.Title className="text-body font-semibold text-text-primary">Settings</Dialog.Title>
            <button onClick={closeModal} className="icon-btn w-6 h-6">
              <X size={14} />
            </button>
          </div>

          {/* Body */}
          <div className="flex flex-1 min-h-0">
            {/* Sidebar */}
            <nav className="w-40 bg-bg-base flex-shrink-0 flex flex-col py-2 gap-0.5 border-r border-bg-divider">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'text-left px-4 py-2 mx-2 text-body rounded-button transition-colors',
                    activeTab === tab.id
                      ? 'bg-state-active text-white font-medium'
                      : 'text-text-muted hover:text-text-primary hover:bg-state-hover'
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </nav>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-5">
              {activeTab === 'general' && (
                <GeneralTab draft={draft.general} set={patchGeneral} />
              )}
              {activeTab === 'video' && (
                <VideoTab draft={draft.video} set={patchVideo} />
              )}
              {activeTab === 'audio' && (
                <AudioTab draft={draft.audio} set={patchAudio} />
              )}
              {activeTab === 'hotkeys' && <HotkeysTab />}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-bg-divider flex-shrink-0">
            <button
              onClick={closeModal}
              className="h-7 px-4 rounded-button text-caption text-text-muted hover:text-text-primary hover:bg-state-hover transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={apply}
              className="h-7 px-4 rounded-button text-caption text-text-secondary bg-bg-panel border border-bg-divider hover:bg-state-hover transition-colors"
            >
              Apply
            </button>
            <button
              onClick={ok}
              className="h-7 px-4 rounded-button text-caption font-medium text-white bg-accent-gradient hover:opacity-90 transition-opacity"
            >
              OK
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
