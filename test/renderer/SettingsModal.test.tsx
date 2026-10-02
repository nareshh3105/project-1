// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installBridge, removeBridge } from '../mocks/bridge'

/**
 * Settings is the one dialog where a stray keystroke can lose work: it holds
 * a draft of every tab, and one tab records raw key presses.
 */

let SettingsModal: typeof import('../../src/components/modals/SettingsModal')['SettingsModal']
let useUIStore: typeof import('../../src/stores/uiStore')['useUIStore']
let useSettingsStore: typeof import('../../src/stores/settingsStore')['useSettingsStore']
let useHotkeyStore: typeof import('../../src/stores/hotkeyStore')['useHotkeyStore']

async function open() {
  render(<SettingsModal />)
  await act(async () => { useUIStore.getState().openModal('settings') })
  return await screen.findByRole('dialog')
}

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  installBridge()
  SettingsModal = (await import('../../src/components/modals/SettingsModal')).SettingsModal
  useUIStore = (await import('../../src/stores/uiStore')).useUIStore
  useSettingsStore = (await import('../../src/stores/settingsStore')).useSettingsStore
  useHotkeyStore = (await import('../../src/stores/hotkeyStore')).useHotkeyStore
})

afterEach(() => {
  cleanup()
  removeBridge()
})

describe('recording a hotkey', () => {
  async function startRecording() {
    await open()
    await userEvent.click(screen.getByText('Hotkeys'))
    const [first] = useHotkeyStore.getState().hotkeys

    // The row holds this action's binding button(s); the first one starts a
    // recording whether it shows a shortcut or "Not bound".
    const row = screen.getByText(first.description).parentElement as HTMLElement
    await userEvent.click(within(row).getAllByRole('button')[0])

    expect(useHotkeyStore.getState().recording).toBe(first.id)
  }

  // The hint reads "Press Escape to cancel". Radix closes a dialog on Escape
  // through its own document listener, so cancelling a recording used to close
  // the whole of Settings and discard every unsaved change on the other tabs.
  it('cancels the recording without closing Settings', async () => {
    await startRecording()

    await userEvent.keyboard('{Escape}')

    expect(useHotkeyStore.getState().recording).toBeNull()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(useUIStore.getState().modal?.type).toBe('settings')
  })

  it('closes Settings on Escape once nothing is recording', async () => {
    await open()
    await userEvent.keyboard('{Escape}')
    expect(useUIStore.getState().modal).toBeNull()
  })
})

describe('draft handling', () => {
  it('discards changes on Cancel', async () => {
    await open()
    const before = useSettingsStore.getState().general.updateChannel

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Update channel' }), 'beta')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(useSettingsStore.getState().general.updateChannel).toBe(before)
  })

  it('commits changes on OK', async () => {
    await open()

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Update channel' }), 'beta')
    await userEvent.click(screen.getByRole('button', { name: 'OK' }))

    expect(useSettingsStore.getState().general.updateChannel).toBe('beta')
    expect(useUIStore.getState().modal).toBeNull()
  })

  it('commits on Apply and stays open', async () => {
    await open()

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Update channel' }), 'beta')
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))

    expect(useSettingsStore.getState().general.updateChannel).toBe('beta')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})

describe('accessible controls', () => {
  it('exposes a toggle as a labelled switch with its state', async () => {
    await open()
    const sw = screen.getByRole('switch', { name: 'Confirm on exit' })
    const was = sw.getAttribute('aria-checked')

    await userEvent.click(sw)

    expect(sw.getAttribute('aria-checked')).not.toBe(was)
  })

  it('names every select by its row label', async () => {
    await open()
    expect(screen.getByRole('combobox', { name: 'Language' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Update channel' })).toBeInTheDocument()
  })

  it('marks the current tab', async () => {
    await open()
    expect(screen.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Video' })).toHaveAttribute('aria-selected', 'false')
  })
})
