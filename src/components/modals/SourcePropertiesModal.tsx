import { useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { useUIStore } from '@/stores/uiStore'
import { useSourceStore } from '@/stores/sourceStore'
import { reportFailure } from '@/stores/notifyStore'
import { ipc } from '@/ipc'
import { cn } from '@/lib/utils'
import {
  FONT_FAMILIES, IMAGE_EXTENSIONS, isHexColor, isStaticType, parseColor, parseImage, parseText,
  type StaticType, type TextAlign,
} from '@/lib/sources/static'
import { fitWithin } from '@/lib/sources/placement'

/** Opened with this as the modal payload. */
export interface SourcePropertiesPayload {
  sceneId: string
  sourceId: string
}

/** How long to wait after typing before saving, so a sentence is one write, not forty. */
const SAVE_DELAY_MS = 300

export function SourcePropertiesModal() {
  const modal = useUIStore((s) => s.modal)
  const closeModal = useUIStore((s) => s.closeModal)
  const open = modal?.type === 'source-properties'
  const payload = open ? (modal?.payload as SourcePropertiesPayload | undefined) : undefined

  const source = useSourceStore((s) =>
    payload ? s.byScene[payload.sceneId]?.find((x) => x.id === payload.sourceId) : undefined)
  const updateSettings = useSourceStore((s) => s.updateSettings)

  // What the dialog shows is held here so typing is never fighting the saved
  // value; it is written back after a pause.
  const [draft, setDraft] = useState<Record<string, unknown>>({})
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<Record<string, unknown> | null>(null)

  useEffect(() => {
    if (open) setDraft(source?.settings ?? {})
    // Only when the dialog opens; the saved copy changing underneath must not reset typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, payload?.sourceId])

  const flush = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    if (pending.current && payload) {
      void updateSettings(payload.sceneId, payload.sourceId, pending.current)
      pending.current = null
    }
  }

  // Closing saves what is waiting rather than dropping it.
  useEffect(() => () => flush(), []) // eslint-disable-line react-hooks/exhaustive-deps

  function change(patch: Record<string, unknown>, immediate = false) {
    setDraft((d) => ({ ...d, ...patch }))
    pending.current = { ...(pending.current ?? {}), ...patch }
    if (timer.current) clearTimeout(timer.current)
    if (immediate) flush()
    else timer.current = setTimeout(flush, SAVE_DELAY_MS)
  }

  function close() {
    flush()
    closeModal()
  }

  if (!open || !payload || !source || !isStaticType(source.sourceType)) {
    return <Dialog.Root open={false}><span /></Dialog.Root>
  }
  const type: StaticType = source.sourceType

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-50 animate-fade-in" />
        <Dialog.Content
          className={cn(
            'fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2',
            'w-[460px] max-w-[92vw] max-h-[85vh] bg-bg-panel border border-bg-divider rounded-panel shadow-modal',
            'flex flex-col animate-fade-in overflow-hidden',
          )}
        >
          <div className="flex items-center justify-between px-5 py-3 border-b border-bg-divider flex-shrink-0">
            <Dialog.Title className="text-body font-semibold text-text-primary">
              {source.name} properties
            </Dialog.Title>
            <Dialog.Description className="sr-only">
              Change how this source looks. Changes are applied as you make them.
            </Dialog.Description>
            <button type="button" onClick={close} className="icon-btn w-6 h-6" aria-label="Close">
              <X size={14} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-3">
            {type === 'color_source' && <ColorFields draft={draft} change={change} />}
            {type === 'text_gdi_plus' && <TextFields draft={draft} change={change} />}
            {type === 'image' && (
              <ImageFields draft={draft} change={change} sceneId={payload.sceneId} sourceId={source.id} />
            )}
          </div>

          <div className="flex justify-end px-5 py-3 border-t border-bg-divider flex-shrink-0">
            <button type="button" onClick={close} className="btn-primary px-4 h-7 rounded-button text-body">
              Done
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// ── Fields ─────────────────────────────────────────────────────────────────

type Draft = Record<string, unknown>
type Change = (patch: Record<string, unknown>, immediate?: boolean) => void

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-4 text-body text-text-secondary">
      <span>{label}</span>
      {children}
    </label>
  )
}

const inputClass =
  'h-7 px-2 rounded-input bg-bg-surface border border-bg-divider text-body text-text-primary ' +
  'focus:outline-none focus:border-accent-start'

function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])

  return (
    <div className="flex items-center justify-between gap-4 text-body text-text-secondary">
      <span>{label}</span>
      <span className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} picker`}
          value={isHexColor(value) && value.length === 7 ? value : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          className="w-8 h-7 p-0 bg-transparent border border-bg-divider rounded-input cursor-pointer"
        />
        <input
          type="text"
          aria-label={label}
          value={text}
          maxLength={7}
          onChange={(e) => {
            setText(e.target.value)
            if (isHexColor(e.target.value)) onChange(e.target.value)
          }}
          className={cn(inputClass, 'w-24 font-mono', !isHexColor(text) && 'border-state-danger')}
        />
      </span>
    </div>
  )
}

function ColorFields({ draft, change }: { draft: Draft; change: Change }) {
  const s = parseColor(draft)
  return <ColorInput label="Color" value={s.color} onChange={(color) => change({ color })} />
}

function TextFields({ draft, change }: { draft: Draft; change: Change }) {
  const s = parseText(draft)
  return (
    <>
      <label className="flex flex-col gap-1 text-body text-text-secondary">
        <span>Text</span>
        <textarea
          aria-label="Text"
          value={typeof draft.text === 'string' ? draft.text : s.text}
          rows={4}
          maxLength={2000}
          onChange={(e) => change({ text: e.target.value })}
          className={cn(inputClass, 'h-auto py-1.5 resize-y')}
        />
      </label>

      <Field label="Font">
        <select aria-label="Font" value={s.fontFamily} onChange={(e) => change({ fontFamily: e.target.value }, true)} className={cn(inputClass, 'w-44')}>
          {FONT_FAMILIES.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </Field>

      <Field label="Size">
        <input
          type="number"
          aria-label="Size"
          min={8}
          max={600}
          value={s.fontSize}
          onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) change({ fontSize: n }) }}
          className={cn(inputClass, 'w-24')}
        />
      </Field>

      <div className="flex items-center gap-6 text-body text-text-secondary">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={s.bold} onChange={(e) => change({ bold: e.target.checked }, true)} className="accent-accent-primary" />
          Bold
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={s.italic} onChange={(e) => change({ italic: e.target.checked }, true)} className="accent-accent-primary" />
          Italic
        </label>
      </div>

      <Field label="Alignment">
        <select aria-label="Alignment" value={s.align} onChange={(e) => change({ align: e.target.value as TextAlign }, true)} className={cn(inputClass, 'w-32')}>
          <option value="left">Left</option>
          <option value="center">Centre</option>
          <option value="right">Right</option>
        </select>
      </Field>

      <ColorInput label="Text color" value={s.color} onChange={(color) => change({ color })} />

      <label className="flex items-center gap-2 text-body text-text-secondary">
        <input
          type="checkbox"
          aria-label="Background"
          checked={s.backgroundColor !== ''}
          onChange={(e) => change({ backgroundColor: e.target.checked ? '#000000' : '' }, true)}
          className="accent-accent-primary"
        />
        Background
      </label>
      {s.backgroundColor !== '' && (
        <ColorInput label="Background color" value={s.backgroundColor} onChange={(backgroundColor) => change({ backgroundColor })} />
      )}
    </>
  )
}

function ImageFields({ draft, change, sceneId, sourceId }: { draft: Draft; change: Change; sceneId: string; sourceId: string }) {
  const { filePath } = parseImage(draft)
  const setTransform = useSourceStore((s) => s.setTransform)
  const commitTransform = useSourceStore((s) => s.commitTransform)
  const base = { width: 1920, height: 1080 }

  async function choose() {
    let picked: string | null
    try {
      picked = await ipc.file.openDialog([{ name: 'Pictures', extensions: [...IMAGE_EXTENSIONS] }])
    } catch (err) {
      reportFailure('open the file chooser', err)
      return
    }
    if (!picked) return

    // Size the source to the picture, so it appears the right shape instead of
    // stretched to fill a box meant for something else.
    try {
      const dims = await measureImage(await ipc.file.readImage(picked))
      const fit = fitWithin(dims, base)
      setTransform(sceneId, sourceId, fit)
      void commitTransform(sceneId, sourceId)
    } catch (err) {
      reportFailure('load that picture', err)
      return
    }
    change({ filePath: picked }, true)
  }

  return (
    <>
      <Field label="Picture">
        <button type="button" aria-label="Choose a picture" onClick={() => void choose()} className="px-3 h-7 rounded-button bg-bg-surface border border-bg-divider text-body text-text-primary hover:border-text-muted">
          Choose…
        </button>
      </Field>
      <p className="text-caption text-text-muted break-all" aria-label="Chosen picture">
        {filePath || 'No picture chosen yet.'}
      </p>
      <p className="text-caption text-text-muted">PNG, JPG, GIF, WebP or BMP, up to 30 MB.</p>
    </>
  )
}

function measureImage(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => reject(new Error('The picture could not be read.'))
    img.src = dataUrl
  })
}
