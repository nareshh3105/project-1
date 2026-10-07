import { createContext, useContext, useState, useEffect, useCallback, useId } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ipc } from '@/ipc'
import { toErrorMessage } from '@/lib/errors'
import { useUIStore } from '@/stores/uiStore'
import {
  useSettingsStore,
  STANDARD_RESOLUTIONS, FRAME_RATES,
  type SettingsState, type RecordingConfig,
} from '@/stores/settingsStore'
import {
  useHotkeyStore,
  formatBinding, keyEventToBinding,
} from '@/stores/hotkeyStore'
import type { GeneralSettings, VideoSettings } from '@/types/settings'
import type { AudioSettings } from '@/types/audio'
import { PRESETS, presetOf, presetPatch, type PresetId } from '@/lib/presets'

// ── Primitives ──────────────────────────────────────────────────────────────

/**
 * The id of the row label the control inside it should be named by. The label
 * is a span beside the control rather than a wrapping <label>, so without this
 * a select or toggle had no accessible name at all and a screen reader said
 * only "combo box" or "button".
 */
const LabelContext = createContext<string | undefined>(undefined)

function Row({ label, hint, children }: { label: string; /** A note under the label, inside the row so the divider does not cut through it. */ hint?: string; children: React.ReactNode }) {
  const labelId = useId()
  return (
    <div className="flex items-center justify-between gap-6 py-2.5 border-b border-bg-divider/40 last:border-0">
      <div className="flex-shrink-0 w-52">
        <span id={labelId} className="block text-body text-text-secondary">{label}</span>
        {hint && <span className="block mt-0.5 text-caption text-text-muted">{hint}</span>}
      </div>
      <div className="flex-1 flex justify-end">
        <LabelContext.Provider value={labelId}>{children}</LabelContext.Provider>
      </div>
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
  const labelledBy = useContext(LabelContext)
  return (
    <select
      aria-labelledby={labelledBy}
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
  const labelledBy = useContext(LabelContext)
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-labelledby={labelledBy}
      onClick={() => onChange(!value)}
      className={cn(
        // The border is always there (clear when on) so the thumb sits in the same place either way.
        'w-9 h-5 rounded-full relative transition-colors flex-shrink-0 border',
        value ? 'bg-accent-start border-transparent' : 'bg-bg-panel border-bg-divider'
      )}
    >
      {/* Positioned from the inside of the border: 2px of room on each side, 14px of travel. */}
      <span
        className={cn(
          'absolute left-0.5 top-px w-4 h-4 rounded-full bg-white transition-transform shadow-sm',
          value ? 'translate-x-[14px]' : 'translate-x-0'
        )}
      />
    </button>
  )
}

/** A folder shown as its path, with buttons to browse for another or go back to the default. */
export function FolderChoice({ value, onChange }: { value: string; onChange: (folder: string) => void }) {
  const labelledBy = useContext(LabelContext)
  const [problem, setProblem] = useState<string | null>(null)

  async function browse() {
    setProblem(null)
    try {
      const chosen = await ipc.file.folderDialog(value || undefined)
      if (chosen) onChange(chosen)
    } catch (err) {
      setProblem(toErrorMessage(err))
    }
  }

  return (
    <div className="flex flex-col items-end gap-1 min-w-0">
      <div className="flex items-center gap-2 min-w-0">
        <span
          aria-labelledby={labelledBy}
          title={value || undefined}
          className="max-w-[220px] truncate text-body text-text-primary"
        >
          {value || 'Default'}
        </span>
        <button
          type="button"
          onClick={browse}
          className="h-7 px-3 rounded-input bg-bg-panel border border-bg-divider text-caption text-text-primary hover:border-accent-start hover:text-accent-start transition-colors"
        >
          Browse…
        </button>
        {value && (
          <button
            type="button"
            onClick={() => { setProblem(null); onChange('') }}
            className="h-7 px-3 rounded-input border border-dashed border-bg-divider text-caption text-text-muted hover:border-accent-start hover:text-accent-start transition-colors"
          >
            Use default
          </button>
        )}
      </div>
      {problem && <span role="alert" className="text-caption text-red-400">{problem}</span>}
    </div>
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
      <Row label="Language" hint="The interface is in English only for now.">
        <Sel
          value={draft.language}
          onChange={(v) => set({ language: v })}
          options={[{ value: 'en-US', label: 'English (US)' }]}
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

function AudioTab({
  draft, set,
}: {
  draft: AudioSettings
  set: (patch: Partial<AudioSettings>) => void
}) {
  const [mics, setMics] = useState<{ id: string; label: string }[]>([])

  useEffect(() => {
    let current = true
    navigator.mediaDevices?.enumerateDevices().then((all) => {
      if (!current) return
      setMics(
        all
          .filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications')
          .map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` })),
      )
    }).catch(() => { /* no list; the system default is still offered */ })
    return () => { current = false }
  }, [])

  const chosen = draft.auxDevice1 === 'default' || draft.auxDevice1 === 'disabled' ? 'default' : draft.auxDevice1
  // A device that was chosen before and is not plugged in now stays visible, so the choice is not lost silently.
  const known = mics.some((m) => m.id === chosen)

  return (
    <div>
      <SectionHeader title="Audio Devices" />
      <Row label="Microphone">
        <Sel
          value={chosen}
          onChange={(v) => set({ auxDevice1: v })}
          options={[
            { value: 'default', label: 'System default' },
            ...mics.map((m) => ({ value: m.id, label: m.label })),
            ...(chosen !== 'default' && !known ? [{ value: chosen, label: 'Chosen device (not connected)' }] : []),
          ]}
        />
      </Row>
      <p className="text-caption text-text-muted mb-3">
        Names appear once the microphone has been connected in the Audio Mixer.
      </p>
      <p className="text-caption text-text-secondary mb-3">
        Press Desktop in the Audio Mixer to capture everything your computer plays (Windows does
        not offer a single output device to capture). The inputs you connect are remembered and
        reconnected when the app starts.
      </p>

      <SectionHeader title="Recorded format" />
      <Row label="Sample Rate">
        <span className="text-body text-text-primary">48 kHz</span>
      </Row>
      <Row label="Channels">
        <span className="text-body text-text-primary">Stereo</span>
      </Row>
      <p className="text-caption text-text-muted mt-3">
        Another sample rate is not available yet. The audio bitrate is set under Output.
      </p>
    </div>
  )
}

// ── Tab: Output ─────────────────────────────────────────────────────────────

function OutputTab({
  draft, set, video, setVideo,
}: {
  draft: RecordingConfig
  set:   (patch: Partial<RecordingConfig>) => void
  video: VideoSettings
  setVideo: (patch: Partial<VideoSettings>) => void
}) {
  const preset = presetOf(video)

  return (
    <div>
      <SectionHeader title="Performance" />
      <Row label="Preset">
        <Sel
          value={preset ?? 'custom'}
          onChange={(v) => { if (v !== 'custom') setVideo(presetPatch(v as PresetId)) }}
          options={[
            ...(preset ? [] : [{ value: 'custom', label: 'Custom (set in the Video tab)' }]),
            ...PRESETS.map((p) => ({ value: p.id as string, label: p.label })),
          ]}
        />
      </Row>
      <p className="text-caption text-text-muted mb-3">
        If the status bar shows dropped frames, or the app says your computer is not keeping up,
        choose a lighter preset. It sets the output size and frame rate.
      </p>

      <SectionHeader title="Recording" />
      <Row label="Save Recordings To" hint={draft.outputFolder ? undefined : 'The Videos folder'}>
        <FolderChoice value={draft.outputFolder} onChange={(folder) => set({ outputFolder: folder })} />
      </Row>
      <Row label="Recording Format">
        <Sel
          value={draft.format}
          onChange={(v) => set({ format: v as RecordingConfig['format'] })}
          options={[
            { value: 'mkv', label: 'Matroska Video (.mkv)' },
            { value: 'mp4', label: 'MPEG-4 (.mp4)' },
          ]}
        />
      </Row>

      <SectionHeader title="Encoding" />
      <Row label="Video Encoder">
        <Sel
          value={draft.encoder}
          onChange={(v) => set({ encoder: v as RecordingConfig['encoder'] })}
          options={[
            { value: 'auto', label: 'Automatic (hardware if available)' },
            { value: 'hardware', label: 'Hardware only' },
            { value: 'software', label: 'Software (x264-class, more CPU)' },
          ]}
        />
      </Row>
      <Row label="Video Bitrate">
        <Sel
          value={String(draft.videoBitrateKbps)}
          onChange={(v) => set({ videoBitrateKbps: Number(v) })}
          options={[
            { value: '0', label: 'Automatic (suits the resolution)' },
            ...[2500, 4000, 6000, 8000, 12000, 20000, 35000].map((k) => ({
              value: String(k), label: `${(k / 1000).toFixed(1)} Mbps`,
            })),
          ]}
        />
      </Row>
      <Row label="Audio Bitrate">
        <Sel
          value={String(draft.audioBitrateKbps)}
          onChange={(v) => set({ audioBitrateKbps: Number(v) })}
          options={[96, 128, 160, 192, 256, 320].map((k) => ({ value: String(k), label: `${k} kbps` }))}
        />
      </Row>
      <Row label="Audio Tracks">
        <Sel
          value={String(draft.audioTracks ?? 1)}
          onChange={(v) => set({ audioTracks: Number(v) as 1 | 2 | 3 })}
          options={[
            { value: '1', label: 'One track (everything mixed)' },
            { value: '2', label: 'Two: mix, and microphone alone' },
            { value: '3', label: 'Three: mix, microphone, and everything else' },
          ]}
        />
      </Row>
      <p className="text-caption text-text-muted mt-3">
        Extra tracks apply to recordings only. Resolution and frame rate come from the Video tab. What you hear in the audio mixer,
        at the levels you set, is what is recorded and streamed.
      </p>
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
                        aria-label={`Remove ${formatBinding(b)} from ${hk.description}`}
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

type TabId = 'general' | 'video' | 'audio' | 'output' | 'hotkeys'

const TABS: { id: TabId; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'video',   label: 'Video' },
  { id: 'audio',   label: 'Audio' },
  { id: 'output',  label: 'Output' },
  { id: 'hotkeys', label: 'Hotkeys' },
]

export function SettingsModal() {
  const { modal, closeModal } = useUIStore((s) => ({ modal: s.modal, closeModal: s.closeModal }))
  const { general, video, audio, recording, applyAll } = useSettingsStore()
  const open = modal?.type === 'settings'

  const [activeTab, setActiveTab] = useState<TabId>('general')

  // Local draft — reset when modal opens
  const [draft, setDraft] = useState<SettingsState>({ general, video, audio, recording })

  useEffect(() => {
    if (open) setDraft({ general, video, audio, recording })
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
  function patchRecording(patch: Partial<RecordingConfig>) {
    setDraft((d) => ({ ...d, recording: { ...d.recording, ...patch } }))
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
          // Radix closes a dialog on Escape through its own document listener,
          // ahead of any handler here. While a hotkey is being recorded Escape
          // means "cancel the recording" (the tab says so), and letting it
          // through closed Settings and threw away every unsaved change on the
          // other tabs. The recorder itself stops on the same keypress.
          onEscapeKeyDown={(e) => { if (useHotkeyStore.getState().recording) e.preventDefault() }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-bg-divider flex-shrink-0">
            <Dialog.Title className="text-body font-semibold text-text-primary">Settings</Dialog.Title>
            <Dialog.Description className="sr-only">Configure general, video, audio and recording options.</Dialog.Description>
            <button onClick={closeModal} className="icon-btn w-6 h-6">
              <X size={14} />
            </button>
          </div>

          {/* Body */}
          <div className="flex flex-1 min-h-0">
            {/* Sidebar */}
            <nav
              role="tablist"
              aria-label="Settings sections"
              aria-orientation="vertical"
              className="w-40 bg-bg-base flex-shrink-0 flex flex-col py-2 gap-0.5 border-r border-bg-divider"
            >
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.id}
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
            <div role="tabpanel" aria-label={TABS.find((t) => t.id === activeTab)?.label} className="flex-1 overflow-y-auto p-5">
              {activeTab === 'general' && (
                <GeneralTab draft={draft.general} set={patchGeneral} />
              )}
              {activeTab === 'video' && (
                <VideoTab draft={draft.video} set={patchVideo} />
              )}
              {activeTab === 'audio' && (
                <AudioTab draft={draft.audio} set={patchAudio} />
              )}
              {activeTab === 'output' && (
                <OutputTab draft={draft.recording} set={patchRecording} video={draft.video} setVideo={patchVideo} />
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
