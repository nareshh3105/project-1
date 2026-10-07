// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installBridge, removeBridge, type BridgeStub } from '../mocks/bridge'

/**
 * Settings, Output, "Save Recordings To": the folder is shown, can be browsed
 * for and reset, and the main process is told whenever it changes.
 */

let bridge: BridgeStub

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  bridge = installBridge()
})

afterEach(() => { cleanup(); removeBridge() })

const setCalls = () => bridge.calls.filter((c) => c.command === 'set_recording_folder').map((c) => c.args.folder)

describe('telling the main process', () => {
  async function mount() {
    const { useRecordingFolder } = await import('../../src/hooks/useRecordingFolder')
    const { useSettingsStore } = await import('../../src/stores/settingsStore')
    const { useNotifyStore } = await import('../../src/stores/notifyStore')
    function Probe() { useRecordingFolder(); return null }
    render(<Probe />)
    return { useSettingsStore, useNotifyStore }
  }

  it('sends the saved folder at startup', async () => {
    localStorage.setItem('cb:settings', JSON.stringify({ recording: { outputFolder: 'D:\\Clips' } }))
    await mount()
    expect(setCalls()).toEqual(['D:\\Clips'])
  })

  it('sends an empty folder, meaning the default, when none was chosen', async () => {
    await mount()
    expect(setCalls()).toEqual([''])
  })

  it('sends a new choice, once', async () => {
    const { useSettingsStore } = await mount()
    act(() => useSettingsStore.getState().updateRecording({ outputFolder: 'E:\\Rec' }))
    act(() => useSettingsStore.getState().updateRecording({ format: 'mp4' }))
    expect(setCalls()).toEqual(['', 'E:\\Rec'])
  })

  it('sends it when Settings are applied', async () => {
    const { useSettingsStore } = await mount()
    const s = useSettingsStore.getState()
    act(() => s.applyAll({ general: s.general, video: s.video, audio: s.audio, recording: { ...s.recording, outputFolder: 'F:\\Out' } }))
    expect(setCalls().at(-1)).toBe('F:\\Out')
  })

  it('says so, and falls back to the default, when the folder cannot be used', async () => {
    bridge.fail('set_recording_folder', 'Cannot save recordings in "Z:\\x": no such drive')
    const { useNotifyStore } = await mount()
    await act(async () => { await Promise.resolve() })

    const text = useNotifyStore.getState().notices.map((n) => n.message).join('\n')
    expect(text).toContain('Cannot save recordings in "Z:\\x": no such drive')
    expect(text).toContain('Videos folder')
  })
})

describe('the Settings field', () => {
  async function open(folder = '') {
    const { FolderChoice } = await import('../../src/components/modals/SettingsModal')
    const changes: string[] = []
    render(<FolderChoice value={folder} onChange={(f) => changes.push(f)} />)
    return changes
  }

  it('says Default until a folder is chosen', async () => {
    await open()
    expect(screen.getByText('Default')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /use default/i })).toBeNull()
  })

  it('shows the folder chosen, and offers to go back', async () => {
    await open('D:\\Clips')
    expect(screen.getByText('D:\\Clips')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /use default/i })).toBeInTheDocument()
  })

  it('takes the folder picked in the dialog', async () => {
    bridge.reply('show_folder_dialog', 'G:\\Picked')
    const changes = await open()
    await userEvent.click(screen.getByRole('button', { name: /browse/i }))
    await vi.waitFor(() => expect(changes).toEqual(['G:\\Picked']))
  })

  it('opens the dialog at the current folder', async () => {
    bridge.reply('show_folder_dialog', null)
    await open('D:\\Clips')
    await userEvent.click(screen.getByRole('button', { name: /browse/i }))
    expect(bridge.argsFor('show_folder_dialog')).toMatchObject({ defaultPath: 'D:\\Clips' })
  })

  it('changes nothing when the dialog is cancelled', async () => {
    bridge.reply('show_folder_dialog', null)
    const changes = await open('D:\\Clips')
    await userEvent.click(screen.getByRole('button', { name: /browse/i }))
    await act(async () => { await Promise.resolve() })
    expect(changes).toEqual([])
  })

  it('goes back to the default', async () => {
    const changes = await open('D:\\Clips')
    await userEvent.click(screen.getByRole('button', { name: /use default/i }))
    expect(changes).toEqual([''])
  })

  it('says why when the dialog cannot open', async () => {
    bridge.fail('show_folder_dialog', 'no window')
    await open()
    await userEvent.click(screen.getByRole('button', { name: /browse/i }))
    expect((await screen.findByRole('alert')).textContent).toBe('no window')
  })
})
