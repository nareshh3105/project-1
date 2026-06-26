import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Plus, Trash2, SlidersHorizontal } from 'lucide-react'
import { useUIStore } from '@/stores/uiStore'
import {
  useFilterStore,
  filterLabel,
  type FilterType,
  type SourceFilter,
  type ColorCorrectionFilter,
  type CropFilter,
  type ChromaKeyFilter,
} from '@/stores/filterStore'
import { cn } from '@/lib/utils'

const FILTER_TYPES: FilterType[] = ['color-correction', 'crop', 'chroma-key']

export function FiltersModal() {
  const modal      = useUIStore((s) => s.modal)
  const closeModal = useUIStore((s) => s.closeModal)

  const isOpen = modal?.type === 'filters'
  const payload = isOpen
    ? (modal.payload as { sourceId: string; sourceName: string })
    : null

  const {
    filtersBySource,
    selectedFilterId,
    addFilter,
    removeFilter,
    toggleFilter,
    updateFilter,
    setSelectedFilter,
  } = useFilterStore()

  const filters: SourceFilter[] = (payload ? filtersBySource[payload.sourceId] : null) ?? []
  const selected = filters.find((f) => f.id === selectedFilterId) ?? filters[0] ?? null

  const [addOpen, setAddOpen] = useState(false)

  function handleAdd(type: FilterType) {
    if (!payload) return
    addFilter(payload.sourceId, type)
    setAddOpen(false)
  }

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => { if (!open) { setAddOpen(false); closeModal() } }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-50" />
        <Dialog.Content
          className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
            w-[680px] max-h-[520px] flex flex-col bg-bg-surface
            rounded-[12px] border border-bg-divider shadow-2xl overflow-hidden"
          onInteractOutside={() => { setAddOpen(false); closeModal() }}
        >
          {/* Title bar */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-bg-divider flex-shrink-0">
            <Dialog.Title className="text-body font-semibold text-text-primary">
              Filters
              {payload?.sourceName && (
                <span className="ml-1.5 font-normal text-text-muted">— {payload.sourceName}</span>
              )}
            </Dialog.Title>
            <button onClick={closeModal} className="icon-btn">
              <X size={14} />
            </button>
          </div>

          {/* Body */}
          <div className="flex flex-1 overflow-hidden min-h-0">
            {/* Left: filter list */}
            <div className="w-[220px] flex flex-col border-r border-bg-divider flex-shrink-0">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted px-3 pt-2 pb-1">
                Active Filters
              </div>

              <div className="flex-1 overflow-y-auto">
                {filters.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-24 gap-2">
                    <SlidersHorizontal size={18} className="text-text-muted opacity-30" />
                    <p className="text-[10px] text-text-muted">No filters added</p>
                  </div>
                ) : (
                  filters.map((f) => (
                    <FilterListItem
                      key={f.id}
                      filter={f}
                      isSelected={selected?.id === f.id}
                      onSelect={() => setSelectedFilter(f.id)}
                      onToggle={() => payload && toggleFilter(payload.sourceId, f.id)}
                      onRemove={() => payload && removeFilter(payload.sourceId, f.id)}
                    />
                  ))
                )}
              </div>

              {/* Add filter */}
              <div className="p-2 border-t border-bg-divider relative">
                <button
                  onClick={() => setAddOpen((o) => !o)}
                  disabled={!payload}
                  className={cn(
                    'w-full flex items-center gap-1.5 px-2 h-7 rounded text-caption',
                    'text-text-secondary hover:text-text-primary hover:bg-state-hover transition-colors',
                    'disabled:opacity-40 disabled:cursor-not-allowed',
                  )}
                >
                  <Plus size={12} />
                  Add Filter
                </button>

                {addOpen && (
                  <div className="absolute bottom-full left-2 right-2 mb-1 bg-bg-panel border border-bg-divider rounded-[8px] shadow-lg z-10 overflow-hidden">
                    {FILTER_TYPES.map((type) => (
                      <button
                        key={type}
                        onClick={() => handleAdd(type)}
                        className="w-full text-left px-3 py-1.5 text-caption text-text-secondary hover:bg-state-hover hover:text-text-primary transition-colors"
                      >
                        {filterLabel(type)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Right: filter settings */}
            <div className="flex-1 overflow-y-auto p-5">
              {selected ? (
                <FilterSettings
                  filter={selected}
                  onUpdate={(patch) =>
                    payload && updateFilter(payload.sourceId, selected.id, patch as Partial<SourceFilter>)
                  }
                />
              ) : (
                <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
                  <SlidersHorizontal size={24} className="text-text-muted opacity-20" />
                  <p className="text-caption text-text-muted">
                    {filters.length === 0
                      ? 'Add a filter using the button on the left'
                      : 'Select a filter to edit its settings'}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end px-4 py-3 border-t border-bg-divider flex-shrink-0">
            <button
              onClick={closeModal}
              className="h-8 px-5 rounded-[6px] text-body font-medium bg-bg-panel text-text-secondary
                hover:bg-state-hover hover:text-text-primary transition-colors"
            >
              Close
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// ── Filter list item ──────────────────────────────────────────────────────────

function FilterListItem({
  filter, isSelected, onSelect, onToggle, onRemove,
}: {
  filter: SourceFilter
  isSelected: boolean
  onSelect: () => void
  onToggle: () => void
  onRemove: () => void
}) {
  return (
    <div
      onClick={onSelect}
      className={cn(
        'flex items-center gap-2 px-3 h-8 cursor-pointer select-none group',
        'border-b border-bg-divider transition-colors',
        isSelected
          ? 'bg-state-active text-text-primary'
          : 'text-text-secondary hover:bg-state-hover hover:text-text-primary',
      )}
    >
      <input
        type="checkbox"
        checked={filter.enabled}
        onChange={onToggle}
        onClick={(e) => e.stopPropagation()}
        className="accent-accent-start w-3 h-3 flex-shrink-0 cursor-pointer"
      />
      <span className={cn('flex-1 text-caption truncate', !filter.enabled && 'opacity-40 line-through')}>
        {filter.name}
      </span>
      <button
        onClick={(e) => { e.stopPropagation(); onRemove() }}
        title="Remove filter"
        className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center
          rounded text-state-danger hover:bg-state-danger/20 transition-all"
      >
        <Trash2 size={10} />
      </button>
    </div>
  )
}

// ── Settings dispatcher ───────────────────────────────────────────────────────

function FilterSettings({ filter, onUpdate }: {
  filter: SourceFilter
  onUpdate: (patch: object) => void
}) {
  switch (filter.type) {
    case 'color-correction':
      return <ColorCorrectionSettings filter={filter} onUpdate={onUpdate as (p: Partial<ColorCorrectionFilter>) => void} />
    case 'crop':
      return <CropSettings filter={filter} onUpdate={onUpdate as (p: Partial<CropFilter>) => void} />
    case 'chroma-key':
      return <ChromaKeySettings filter={filter} onUpdate={onUpdate as (p: Partial<ChromaKeyFilter>) => void} />
  }
}

// ── Color Correction ──────────────────────────────────────────────────────────

function ColorCorrectionSettings({ filter, onUpdate }: {
  filter: ColorCorrectionFilter
  onUpdate: (patch: Partial<ColorCorrectionFilter>) => void
}) {
  return (
    <div className="flex flex-col gap-5">
      <SectionTitle>Color Correction</SectionTitle>
      <SliderRow label="Brightness" value={filter.brightness} min={-1}   max={1}   step={0.01} format={(v) => v.toFixed(2)}       onChange={(v) => onUpdate({ brightness: v })} />
      <SliderRow label="Contrast"   value={filter.contrast}   min={0}    max={4}   step={0.01} format={(v) => v.toFixed(2)}       onChange={(v) => onUpdate({ contrast: v })} />
      <SliderRow label="Saturation" value={filter.saturation} min={0}    max={4}   step={0.01} format={(v) => v.toFixed(2)}       onChange={(v) => onUpdate({ saturation: v })} />
      <SliderRow label="Hue Shift"  value={filter.hue}        min={-180} max={180} step={1}    format={(v) => `${v}°`}            onChange={(v) => onUpdate({ hue: v })} />
      <SliderRow label="Opacity"    value={filter.opacity}    min={0}    max={1}   step={0.01} format={(v) => v.toFixed(2)}       onChange={(v) => onUpdate({ opacity: v })} />
    </div>
  )
}

// ── Crop / Pad ────────────────────────────────────────────────────────────────

function CropSettings({ filter, onUpdate }: {
  filter: CropFilter
  onUpdate: (patch: Partial<CropFilter>) => void
}) {
  return (
    <div className="flex flex-col gap-5">
      <SectionTitle>Crop / Pad</SectionTitle>
      <p className="text-[11px] text-text-muted -mt-3">Pixel amounts to crop from each edge of the source.</p>
      <div className="grid grid-cols-2 gap-x-8 gap-y-4">
        <NumInput label="Left"   value={filter.left}   onChange={(v) => onUpdate({ left: v })} />
        <NumInput label="Right"  value={filter.right}  onChange={(v) => onUpdate({ right: v })} />
        <NumInput label="Top"    value={filter.top}    onChange={(v) => onUpdate({ top: v })} />
        <NumInput label="Bottom" value={filter.bottom} onChange={(v) => onUpdate({ bottom: v })} />
      </div>
    </div>
  )
}

// ── Chroma Key ────────────────────────────────────────────────────────────────

function ChromaKeySettings({ filter, onUpdate }: {
  filter: ChromaKeyFilter
  onUpdate: (patch: Partial<ChromaKeyFilter>) => void
}) {
  return (
    <div className="flex flex-col gap-5">
      <SectionTitle>Chroma Key</SectionTitle>

      <div className="flex items-center justify-between">
        <span className="text-caption text-text-secondary w-24 flex-shrink-0">Key Color</span>
        <div className="flex-1 flex items-center gap-3 justify-end">
          <input
            type="color"
            value={filter.keyColor}
            onChange={(e) => onUpdate({ keyColor: e.target.value })}
            className="w-9 h-7 rounded cursor-pointer border border-bg-divider bg-bg-panel p-0.5"
          />
          <span className="text-caption text-text-muted font-mono">{filter.keyColor.toUpperCase()}</span>
        </div>
      </div>

      <SliderRow label="Similarity"  value={filter.similarity}  min={1}  max={1000} step={1}    format={(v) => String(v)}    onChange={(v) => onUpdate({ similarity: v })} />
      <SliderRow label="Smoothness"  value={filter.smoothness}  min={1}  max={1000} step={1}    format={(v) => String(v)}    onChange={(v) => onUpdate({ smoothness: v })} />
      <SliderRow label="Opacity"     value={filter.opacity}     min={0}  max={1}    step={0.01} format={(v) => v.toFixed(2)} onChange={(v) => onUpdate({ opacity: v })} />
    </div>
  )
}

// ── Shared primitives ─────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-body font-semibold text-text-primary">{children}</h3>
}

function SliderRow({ label, value, min, max, step, format, onChange }: {
  label: string
  value: number
  min: number
  max: number
  step: number
  format: (v: number) => string
  onChange: (v: number) => void
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 text-caption text-text-secondary flex-shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="flex-1 accent-accent-start cursor-pointer"
        style={{ height: '4px' }}
      />
      <span className="w-14 text-right text-caption text-text-muted font-mono tabular-nums">
        {format(value)}
      </span>
    </div>
  )
}

function NumInput({ label, value, onChange }: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[10px] font-medium uppercase tracking-wide text-text-muted">{label}</label>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(Math.max(0, parseInt(e.target.value) || 0))}
        className="h-8 px-2 rounded-[6px] text-caption bg-bg-panel border border-bg-divider
          text-text-primary focus:outline-none focus:border-accent-start selectable"
      />
    </div>
  )
}
