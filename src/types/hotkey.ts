import type { ID } from './common'

export type ModifierKey = 'ctrl' | 'shift' | 'alt' | 'meta'

export interface KeyBinding {
  key: string           // e.g. "F5", "Space", "1"
  modifiers: ModifierKey[]
}

export interface Hotkey {
  id: ID
  action: HotkeyAction
  bindings: KeyBinding[]
  description: string
}

export type HotkeyAction =
  | 'start_streaming'
  | 'stop_streaming'
  | 'start_recording'
  | 'stop_recording'
  | 'pause_recording'
  | 'split_recording'
  | 'start_replay_buffer'
  | 'stop_replay_buffer'
  | 'save_replay_buffer'
  | 'toggle_virtual_camera'
  | 'toggle_studio_mode'
  | 'switch_scene_preview'
  | 'switch_scene_program'
  | 'take_screenshot'
  | 'toggle_mute_desktop'
  | 'toggle_mute_mic'
  | 'push_to_mute_desktop'
  | 'push_to_talk_mic'
  | 'transition_scene'
  | string              // plugin-defined actions

export const DEFAULT_HOTKEYS: Omit<Hotkey, 'id'>[] = [
  {
    action: 'start_streaming',
    bindings: [],
    description: 'Start Streaming',
  },
  {
    action: 'stop_streaming',
    bindings: [],
    description: 'Stop Streaming',
  },
  {
    action: 'start_recording',
    bindings: [],
    description: 'Start Recording',
  },
  {
    action: 'pause_recording',
    bindings: [],
    description: 'Pause Recording',
  },
  {
    action: 'save_replay_buffer',
    bindings: [{ key: 'F10', modifiers: [] }],
    description: 'Save Replay Buffer',
  },
  {
    action: 'take_screenshot',
    bindings: [{ key: 'F11', modifiers: [] }],
    description: 'Take Screenshot',
  },
  {
    action: 'toggle_studio_mode',
    bindings: [],
    description: 'Toggle Studio Mode',
  },
]
