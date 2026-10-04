// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installBridge, removeBridge } from '../mocks/bridge'

/**
 * Choosing a microphone: the choice is made in Settings (so OK and Cancel apply
 * as for every setting), reaches the audio store, and switches a connected
 * microphone over to the new device.
 */

const requestMicrophone = vi.fn()
const attach = vi.fn()

vi.mock('../../src/lib/audio/engine', () => ({
  AudioEngine: class {
    start() {}
    attach(...a: unknown[]) { attach(...a) }
    detach() {}
    async dispose() {}
  },
  requestMicrophone: (...a: unknown[]) => requestMicrophone(...a),
  requestDesktopAudio: vi.fn(async () => ({ getTracks: () => [] }) as unknown as MediaStream),
}))

const stream = () => ({ getTracks: () => [{ stop: vi.fn() }] }) as unknown as MediaStream
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })

let useSettingsStore: typeof import('../../src/stores/settingsStore')['useSettingsStore']
let useAudioStore: typeof import('../../src/stores/audioStore')['useAudioStore']
let useAudioDevices: typeof import('../../src/hooks/useAudioDevices')['useAudioDevices']
let SettingsModal: typeof import('../../src/components/modals/SettingsModal')['SettingsModal']
let AudioMixerPanel: typeof import('../../src/components/panels/AudioMixerPanel')['AudioMixerPanel']
let useUIStore: typeof import('../../src/stores/uiStore')['useUIStore']

function stubDevices(list: Array<{ deviceId: string; label: string; kind?: string }>) {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { enumerateDevices: async () => list.map((d) => ({ kind: 'audioinput', ...d })) },
  })
}

function Hook() {
  useAudioDevices()
  return null
}

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  installBridge()
  requestMicrophone.mockReset().mockImplementation(async () => stream())
  attach.mockReset()
  stubDevices([])
  useSettingsStore = (await import('../../src/stores/settingsStore')).useSettingsStore
  useAudioStore = (await import('../../src/stores/audioStore')).useAudioStore
  useAudioDevices = (await import('../../src/hooks/useAudioDevices')).useAudioDevices
  SettingsModal = (await import('../../src/components/modals/SettingsModal')).SettingsModal
  AudioMixerPanel = (await import('../../src/components/panels/AudioMixerPanel')).AudioMixerPanel
  useUIStore = (await import('../../src/stores/uiStore')).useUIStore
})
afterEach(() => { cleanup(); removeBridge() })

describe('the microphone setting reaching the mixer', () => {
  it('means the system default out of the box', () => {
    render(<Hook />)
    expect(useAudioStore.getState().devices.mic).toBeUndefined()
  })

  it('carries a chosen device to the audio store', () => {
    render(<Hook />)
    act(() => useSettingsStore.getState().updateAudio({ auxDevice1: 'usb-1' }))
    expect(useAudioStore.getState().devices.mic).toBe('usb-1')
  })

  it('goes back to the default when the choice is cleared', () => {
    render(<Hook />)
    act(() => useSettingsStore.getState().updateAudio({ auxDevice1: 'usb-1' }))
    act(() => useSettingsStore.getState().updateAudio({ auxDevice1: 'default' }))
    expect(useAudioStore.getState().devices.mic).toBeUndefined()
  })

  it.each(['disabled', ''])('treats %j as no choice', (value) => {
    render(<Hook />)
    act(() => useSettingsStore.getState().updateAudio({ auxDevice1: value }))
    expect(useAudioStore.getState().devices.mic).toBeUndefined()
  })

  it('applies a choice saved in an earlier session when the app starts', () => {
    useSettingsStore.getState().updateAudio({ auxDevice1: 'usb-9' })
    render(<Hook />)
    expect(useAudioStore.getState().devices.mic).toBe('usb-9')
  })
})

describe('the mixer following the choice', () => {
  it('connects the chosen device', async () => {
    useAudioStore.getState().setDevice('mic', 'usb-1')
    render(<AudioMixerPanel />)
    await userEvent.setup().click(screen.getByRole('button', { name: /^mic$/i }))
    await settle()

    expect(requestMicrophone).toHaveBeenCalledWith('usb-1')
  })

  it('connects the default when none is chosen', async () => {
    render(<AudioMixerPanel />)
    await userEvent.setup().click(screen.getByRole('button', { name: /^mic$/i }))
    await settle()

    expect(requestMicrophone).toHaveBeenCalledWith(undefined)
  })

  it('switches a connected microphone over to a newly chosen device', async () => {
    render(<AudioMixerPanel />)
    await userEvent.setup().click(screen.getByRole('button', { name: /^mic$/i }))
    await settle()
    requestMicrophone.mockClear()

    act(() => useAudioStore.getState().setDevice('mic', 'usb-2'))
    await settle()

    expect(requestMicrophone).toHaveBeenCalledWith('usb-2')
    expect(attach).toHaveBeenCalledTimes(2)
  })

  it('leaves a microphone that is not connected alone when the choice changes', async () => {
    render(<AudioMixerPanel />)
    await settle()
    act(() => useAudioStore.getState().setDevice('mic', 'usb-2'))
    await settle()
    expect(requestMicrophone).not.toHaveBeenCalled()
  })
})

describe('the Settings → Audio tab', () => {
  async function openAudioTab() {
    render(<SettingsModal />)
    await act(async () => { useUIStore.getState().openModal('settings') })
    await userEvent.click(await screen.findByText('Audio'))
    await settle()
  }

  it('lists the microphones the system has, after the system default', async () => {
    stubDevices([
      { deviceId: 'default', label: 'Default - Headset' },
      { deviceId: 'usb-1', label: 'USB Microphone' },
      { deviceId: 'bt-2', label: 'Headset Mic' },
    ])
    await openAudioTab()

    const options = within(screen.getByRole('combobox', { name: 'Microphone' })).getAllByRole('option').map((o) => o.textContent)
    expect(options).toEqual(['System default', 'USB Microphone', 'Headset Mic'])
  })

  it('names unnamed devices rather than leaving blanks', async () => {
    stubDevices([{ deviceId: 'a', label: '' }, { deviceId: 'b', label: '' }])
    await openAudioTab()
    const options = within(screen.getByRole('combobox', { name: 'Microphone' })).getAllByRole('option').map((o) => o.textContent)
    expect(options).toEqual(['System default', 'Microphone 1', 'Microphone 2'])
  })

  it('applies a choice only when OK is pressed', async () => {
    stubDevices([{ deviceId: 'usb-1', label: 'USB Microphone' }])
    await openAudioTab()

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Microphone' }), 'usb-1')
    expect(useSettingsStore.getState().audio.auxDevice1).toBe('default')

    await userEvent.click(screen.getByRole('button', { name: /^ok$/i }))
    expect(useSettingsStore.getState().audio.auxDevice1).toBe('usb-1')
  })

  it('throws the choice away on Cancel', async () => {
    stubDevices([{ deviceId: 'usb-1', label: 'USB Microphone' }])
    await openAudioTab()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Microphone' }), 'usb-1')
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(useSettingsStore.getState().audio.auxDevice1).toBe('default')
  })

  it('keeps showing a device that was chosen and is no longer plugged in', async () => {
    useSettingsStore.getState().updateAudio({ auxDevice1: 'unplugged' })
    stubDevices([{ deviceId: 'usb-1', label: 'USB Microphone' }])
    await openAudioTab()

    expect(screen.getByRole('combobox', { name: 'Microphone' })).toHaveValue('unplugged')
    expect(screen.getByRole('option', { name: /not connected/i })).toBeInTheDocument()
  })

  it('still works when the device list cannot be read', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { enumerateDevices: async () => { throw new Error('blocked') } },
    })
    await openAudioTab()
    expect(screen.getByRole('option', { name: 'System default' })).toBeInTheDocument()
  })
})

import { within } from '@testing-library/react'
