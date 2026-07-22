import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { register, unregisterAll, type ShortcutEvent } from '@tauri-apps/plugin-global-shortcut'
import { DEFAULT_HOTKEYS, type Hotkey, type KeyBinding, type ModifierKey } from '@/types/hotkey'
import { ipc } from '@/ipc'
import { generateId } from '@/lib/utils'

const STORAGE_KEY = 'cb:hotkeys'

function loadHotkeys(): Hotkey[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return DEFAULT_HOTKEYS.map((h) => ({ ...h, id: generateId() }))
}

function saveHotkeys(hotkeys: Hotkey[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(hotkeys)) } catch { /* ignore */ }
}

export function formatBinding(b: KeyBinding): string {
  return [...b.modifiers.map((m) => m[0].toUpperCase() + m.slice(1)), b.key].join('+')
}

export function keyEventToBinding(e: KeyboardEvent): KeyBinding | null {
  const key = e.key
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) return null
  const modifiers: ModifierKey[] = []
  if (e.ctrlKey)  modifiers.push('ctrl')
  if (e.shiftKey) modifiers.push('shift')
  if (e.altKey)   modifiers.push('alt')
  if (e.metaKey)  modifiers.push('meta')
  return { key, modifiers }
}

// ── Key format conversion ─────────────────────────────────────────────────
// Converts a KeyBinding to Tauri's global-shortcut format, e.g. "Ctrl+Shift+F5"

const MOD_MAP: Record<string, string> = {
  ctrl: 'Ctrl', shift: 'Shift', alt: 'Alt', meta: 'Super',
}

function bindingToShortcut(b: KeyBinding): string {
  return [...b.modifiers.map((m) => MOD_MAP[m] ?? m), b.key].join('+')
}

// ── Action dispatcher ─────────────────────────────────────────────────────
// Maps HotkeyAction strings to real app operations.
// Called from the OS-level shortcut handler; must NOT use React hooks.

async function dispatchAction(action: string): Promise<void> {
  // Don't dispatch while user is recording a new hotkey
  if (useHotkeyStore.getState().recording) return

  // Lazy import to avoid circular deps at module init time
  const { useOutputStore } = await import('./outputStore')
  const { useUIStore }     = await import('./uiStore')
  const { useAudioStore }  = await import('./audioStore')

  const output = useOutputStore.getState()
  const ui     = useUIStore.getState()

  switch (action) {
    case 'start_recording':
      if (!output.recording.active) {
        const path = await ipc.output.getRecordingPath().catch(() => null)
        await ipc.output.startRecording(path ?? undefined).catch(console.warn)
      }
      break

    case 'stop_recording':
      if (output.recording.active)
        await ipc.output.stopRecording().catch(console.warn)
      break

    case 'start_streaming':
      if (!output.streaming.active) {
        const { rtmpUrl, streamKey } = output.stream
        if (rtmpUrl) await ipc.output.startStreaming(rtmpUrl, streamKey).catch(console.warn)
      }
      break

    case 'stop_streaming':
      if (output.streaming.active)
        await ipc.output.stopStreaming().catch(console.warn)
      break

    case 'start_replay_buffer':
      if (!output.replayBuffer.active)
        await ipc.replay.start(30).catch(console.warn)
      break

    case 'stop_replay_buffer':
      if (output.replayBuffer.active)
        await ipc.replay.stop().catch(console.warn)
      break

    case 'save_replay_buffer':
      if (output.replayBuffer.active)
        await ipc.replay.save().catch(console.warn)
      break

    case 'toggle_virtual_camera':
      if (output.virtualCamera.active)
        await ipc.output.stopVirtualCamera().catch(console.warn)
      else
        await ipc.output.startVirtualCamera().catch(console.warn)
      break

    case 'take_screenshot':
      await ipc.screenshot.take().catch(console.warn)
      break

    case 'toggle_studio_mode':
      ui.toggleStudioMode()
      break

    case 'toggle_mute_desktop': {
      const ch = useAudioStore.getState().channels.find((c) => c.id === 'desktop')
      if (ch) {
        const next = !ch.muted
        useAudioStore.getState().setMuted('desktop', next)
        await ipc.audio.setMuted('desktop', next).catch(console.warn)
      }
      break
    }

    case 'toggle_mute_mic': {
      const ch = useAudioStore.getState().channels.find((c) => c.id === 'mic')
      if (ch) {
        const next = !ch.muted
        useAudioStore.getState().setMuted('mic', next)
        await ipc.audio.setMuted('mic', next).catch(console.warn)
      }
      break
    }

    default:
      break
  }
}

// ── Global shortcut sync ──────────────────────────────────────────────────
// Unregisters all then re-registers every bound hotkey with the OS.

async function syncShortcuts(hotkeys: Hotkey[]): Promise<void> {
  try {
    await unregisterAll()
    for (const hk of hotkeys) {
      for (const binding of hk.bindings) {
        const shortcut = bindingToShortcut(binding)
        const action   = hk.action
        await register(shortcut, (event: ShortcutEvent) => {
          if (event.state === 'Pressed') {
            dispatchAction(action)
          }
        }).catch((e) => console.warn(`[hotkeys] failed to register "${shortcut}":`, e))
      }
    }
  } catch (err) {
    console.warn('[hotkeys] syncShortcuts error:', err)
  }
}

// ── Store ─────────────────────────────────────────────────────────────────

interface HotkeyState {
  hotkeys:   Hotkey[]
  recording: string | null   // hotkey id currently being recorded
}

interface HotkeyActions {
  startRecording:        (id: string) => void
  stopRecording:         () => void
  setBinding:            (id: string, binding: KeyBinding) => void
  removeBinding:         (id: string, bindingIndex: number) => void
  syncGlobalShortcuts:   () => Promise<void>
}

export const useHotkeyStore = create<HotkeyState & HotkeyActions>()(
  immer((set, get) => ({
    hotkeys:   loadHotkeys(),
    recording: null,

    startRecording: (id) => set((s) => { s.recording = id }),
    stopRecording:  ()   => set((s) => { s.recording = null }),

    setBinding: (id, binding) => {
      set((s) => {
        const hk = s.hotkeys.find((h) => h.id === id)
        if (!hk) return
        if (hk.bindings.length > 0) hk.bindings[0] = binding
        else hk.bindings.push(binding)
      })
      const hotkeys = get().hotkeys
      saveHotkeys(hotkeys)
      syncShortcuts(hotkeys)
    },

    removeBinding: (id, index) => {
      set((s) => {
        const hk = s.hotkeys.find((h) => h.id === id)
        if (hk) hk.bindings.splice(index, 1)
      })
      const hotkeys = get().hotkeys
      saveHotkeys(hotkeys)
      syncShortcuts(hotkeys)
    },

    syncGlobalShortcuts: () => syncShortcuts(get().hotkeys),
  }))
)
