import * as Dialog from '@radix-ui/react-dialog'
import {
  Monitor, AppWindow, Gamepad2, Camera, Speaker, Mic,
  Image, Film, Globe, Palette, Type, Layers, X,
} from 'lucide-react'
import type { SourceType } from '@/types'
import { cn } from '@/lib/utils'

interface SourceTypeDef {
  type: SourceType
  label: string
  icon: React.ReactNode
  description: string
}

const SOURCE_TYPES: SourceTypeDef[] = [
  { type: 'display_capture',  label: 'Display Capture',    icon: <Monitor size={20} />,    description: 'Capture an entire monitor' },
  { type: 'window_capture',   label: 'Window Capture',     icon: <AppWindow size={20} />,  description: 'Capture a specific window' },
  { type: 'game_capture',     label: 'Game Capture',       icon: <Gamepad2 size={20} />,   description: 'DirectX / Vulkan game hook' },
  { type: 'dshow_video',      label: 'Video Capture',      icon: <Camera size={20} />,     description: 'Webcam or capture card' },
  { type: 'wasapi_output',    label: 'Desktop Audio',      icon: <Speaker size={20} />,    description: 'System audio loopback' },
  { type: 'wasapi_input',     label: 'Microphone',         icon: <Mic size={20} />,        description: 'Microphone or audio input' },
  { type: 'image',            label: 'Image',              icon: <Image size={20} />,      description: 'PNG, JPG or animated GIF' },
  { type: 'media_source',     label: 'Media Source',       icon: <Film size={20} />,       description: 'Video or audio file / URL' },
  { type: 'browser_source',   label: 'Browser Source',     icon: <Globe size={20} />,      description: 'Web overlay via CEF' },
  { type: 'color_source',     label: 'Color Source',       icon: <Palette size={20} />,    description: 'Solid color fill' },
  { type: 'text_gdi_plus',    label: 'Text (GDI+)',        icon: <Type size={20} />,       description: 'Text label' },
  { type: 'scene',            label: 'Scene',              icon: <Layers size={20} />,     description: 'Nest another scene' },
]

interface AddSourceModalProps {
  open: boolean
  onAdd: (type: SourceType, name: string) => void
  onClose: () => void
}

export function AddSourceModal({ open, onAdd, onClose }: AddSourceModalProps) {
  function handlePick(def: SourceTypeDef) {
    onAdd(def.type, def.label)
    onClose()
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-50 animate-fade-in" />
        <Dialog.Content
          className={cn(
            'fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2',
            'w-[520px] bg-bg-panel border border-bg-divider rounded-panel shadow-modal',
            'flex flex-col animate-fade-in overflow-hidden'
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-bg-divider">
            <Dialog.Title className="text-body font-medium text-text-primary">
              Add Source
            </Dialog.Title>
            <button onClick={onClose} className="icon-btn">
              <X size={14} />
            </button>
          </div>

          {/* Grid */}
          <div className="grid grid-cols-3 gap-2 p-4 overflow-y-auto max-h-[60vh]">
            {SOURCE_TYPES.map((def) => (
              <button
                key={def.type}
                onClick={() => handlePick(def)}
                className={cn(
                  'flex flex-col items-center gap-2 p-3 rounded-input',
                  'bg-bg-surface border border-bg-divider text-center',
                  'hover:border-accent-start hover:bg-state-active transition-colors group'
                )}
              >
                <span className="text-text-muted group-hover:text-accent-start transition-colors">
                  {def.icon}
                </span>
                <span className="text-caption font-medium text-text-secondary group-hover:text-text-primary transition-colors">
                  {def.label}
                </span>
                <span className="text-[10px] text-text-muted leading-tight">
                  {def.description}
                </span>
              </button>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
