import { useCallback, useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, RefreshCw, Monitor, AppWindow, Camera } from 'lucide-react'
import { useUIStore } from '@/stores/uiStore'
import { useSourceStore } from '@/stores/sourceStore'
import { useCaptureStore } from '@/stores/captureStore'
import { ipc } from '@/ipc'
import { cn } from '@/lib/utils'
import {
  targetKindFor, parseCaptureTarget, type CaptureTarget, type CaptureTargetKind,
} from '@/lib/capture/target'
import type { SourceType } from '@/types'

/** Opened with this as the modal payload. */
export interface CapturePickerPayload {
  sceneId: string
  sourceId: string
  sourceType: SourceType
}

interface Choice {
  id: string
  name: string
  thumbnail: string | null
  icon: string | null
}

const TITLES: Record<CaptureTargetKind, string> = {
  screen: 'Choose a screen to capture',
  window: 'Choose a window to capture',
  camera: 'Choose a camera',
}

const EMPTY: Record<CaptureTargetKind, string> = {
  screen: 'No screens were found.',
  window: 'No windows are open to capture. Open the window you want and refresh.',
  camera: 'No camera was found. Connect one and refresh.',
}

const ICONS: Record<CaptureTargetKind, typeof Monitor> = {
  screen: Monitor, window: AppWindow, camera: Camera,
}

async function loadChoices(kind: CaptureTargetKind): Promise<Choice[]> {
  if (kind === 'camera') {
    let devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput')

    // Names are withheld until the page has been given camera access once.
    if (devices.length > 0 && devices.every((d) => !d.label)) {
      try {
        const probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        probe.getTracks().forEach((t) => t.stop())
        devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput')
      } catch { /* keep the unnamed list; the user can still choose */ }
    }

    return devices.map((d, i) => ({
      id: d.deviceId, name: d.label || `Camera ${i + 1}`, thumbnail: null, icon: null,
    }))
  }

  const sources = await ipc.capture.listSources([kind])
  return sources.map((s) => ({ id: s.id, name: s.name, thumbnail: s.thumbnail, icon: s.icon }))
}

export function CapturePickerModal() {
  const { modal, closeModal } = useUIStore((s) => ({ modal: s.modal, closeModal: s.closeModal }))
  const open = modal?.type === 'capture-picker'
  const payload = open ? (modal?.payload as CapturePickerPayload | undefined) : undefined

  const kind = payload ? targetKindFor(payload.sourceType) : null
  const source = useSourceStore((s) =>
    payload ? s.byScene[payload.sceneId]?.find((x) => x.id === payload.sourceId) : undefined,
  )

  const [choices, setChoices] = useState<Choice[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!kind) return
    setLoading(true)
    setError(null)
    try {
      setChoices(await loadChoices(kind))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setChoices([])
    } finally {
      setLoading(false)
    }
  }, [kind])

  // Load on open, and start from what this source already points at.
  useEffect(() => {
    if (!open) return
    setSelected(parseCaptureTarget(source?.settings)?.id ?? null)
    void refresh()
    // Only when the dialog opens; a later settings change must not reset the choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, refresh])

  /** Saves the choice on the source and starts capturing it. */
  async function choose(id: string | null) {
    if (!payload || !kind || !id) return
    const choice = choices.find((c) => c.id === id)
    if (!choice) return

    const target: CaptureTarget = { kind, id: choice.id, name: choice.name }
    closeModal()

    const saved = await useSourceStore.getState().setCaptureTarget(payload.sceneId, payload.sourceId, target)
    if (saved) await useCaptureStore.getState().startCapture(payload.sourceId, payload.sourceType, target)
  }

  const Icon = kind ? ICONS[kind] : Monitor

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && closeModal()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-50 animate-fade-in" />
        <Dialog.Content
          className={cn(
            'fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2',
            'w-[640px] max-w-[92vw] max-h-[80vh] bg-bg-panel border border-bg-divider rounded-panel shadow-modal',
            'flex flex-col animate-fade-in overflow-hidden',
          )}
        >
          <div className="flex items-center justify-between px-5 py-3 border-b border-bg-divider flex-shrink-0">
            <Dialog.Title className="text-body font-semibold text-text-primary">
              {kind ? TITLES[kind] : 'Choose what to capture'}
            </Dialog.Title>
            <Dialog.Description className="sr-only">
              Pick the screen, window or camera this source should show. The choice is remembered.
            </Dialog.Description>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="icon-btn w-6 h-6"
                onClick={() => void refresh()}
                disabled={loading}
                aria-label="Refresh the list"
                title="Refresh the list"
              >
                <RefreshCw size={13} className={loading ? 'animate-spin' : undefined} />
              </button>
              <button type="button" onClick={closeModal} className="icon-btn w-6 h-6" aria-label="Close">
                <X size={14} />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 min-h-[200px]">
            {error && (
              <p role="alert" className="text-caption text-state-danger bg-state-danger/10 px-3 py-2 rounded-input">
                {error}
              </p>
            )}

            {!error && !loading && choices.length === 0 && kind && (
              <p className="text-caption text-text-muted text-center py-10">{EMPTY[kind]}</p>
            )}

            {loading && choices.length === 0 && (
              <p className="text-caption text-text-muted text-center py-10">Looking for sources…</p>
            )}

            <div role="radiogroup" aria-label={kind ? TITLES[kind] : 'Sources'} className="grid grid-cols-2 gap-3">
              {choices.map((c) => {
                const isSelected = c.id === selected
                return (
                  <button
                    key={c.id}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => setSelected(c.id)}
                    onDoubleClick={() => void choose(c.id)}
                    className={cn(
                      'flex flex-col gap-1.5 p-2 rounded-button border text-left transition-colors',
                      isSelected
                        ? 'border-accent-start bg-state-active'
                        : 'border-bg-divider hover:border-text-muted hover:bg-state-hover',
                    )}
                  >
                    <div className="aspect-video w-full rounded-sm bg-black overflow-hidden flex items-center justify-center">
                      {c.thumbnail ? (
                        <img src={c.thumbnail} alt="" className="w-full h-full object-contain" />
                      ) : (
                        <Icon size={28} className="text-text-muted opacity-40" />
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 min-w-0">
                      {c.icon && <img src={c.icon} alt="" className="w-4 h-4 flex-shrink-0" />}
                      <span className="text-caption text-text-primary truncate" title={c.name}>{c.name}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex justify-end gap-2 px-5 py-3 border-t border-bg-divider flex-shrink-0">
            <button
              type="button"
              onClick={closeModal}
              className="h-7 px-4 rounded-button text-caption text-text-muted hover:text-text-primary hover:bg-state-hover transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void choose(selected)}
              disabled={!selected}
              className="h-7 px-5 rounded-button text-caption font-medium text-white bg-accent-gradient hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              Select
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
