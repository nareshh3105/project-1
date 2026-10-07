// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installBridge, removeBridge, type BridgeStub } from '../mocks/bridge'

/**
 * Toolbar toasts are the only feedback for actions that report nothing else —
 * a recordings folder that cannot be opened says so here or nowhere.
 */

let Toolbar: typeof import('../../src/components/layout/Toolbar')['Toolbar']
let bridge: BridgeStub

const TOAST_MS = 3500

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  bridge = installBridge()
  Toolbar = (await import('../../src/components/layout/Toolbar')).Toolbar
})

afterEach(() => {
  cleanup()
  removeBridge()
  vi.useRealTimers()
})

const folderButton = () => screen.getByRole('button', { name: /open recording folder/i })

describe('the buttons', () => {
  // Screenshot and Settings are in the Controls panel. They were on both, so each had two buttons.
  it('does not repeat what the Controls panel has', () => {
    render(<Toolbar />)
    expect(screen.queryByRole('button', { name: /screenshot/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^settings$/i })).toBeNull()
  })

  it('keeps the ones that are only here', () => {
    render(<Toolbar />)
    for (const name of [/studio mode/i, /fullscreen preview/i, /stats/i, /multiview/i, /open recording folder/i]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
  })
})

describe('transient feedback', () => {
  it('surfaces a failure instead of staying silent', async () => {
    bridge.fail('open_recordings_folder', 'The folder is missing')
    render(<Toolbar />)

    await userEvent.click(folderButton())

    expect(await screen.findByText(/folder is missing/)).toBeInTheDocument()
  })

  it('shows nothing when it works', async () => {
    render(<Toolbar />)
    await userEvent.click(folderButton())
    expect(bridge.argsFor('open_recordings_folder')).toBeDefined()
    expect(document.querySelector('span[title]')).toBeNull()
  })

  /**
   * The regression. The dismiss timer was never cancelled, so a second toast
   * inherited the first one's countdown: trigger one, wait three seconds,
   * trigger another, and the second vanished after half a second.
   */
  it('gives a second toast its own full duration', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    bridge.fail('open_recordings_folder', 'first failure')
    render(<Toolbar />)

    await user.click(folderButton())
    await waitFor(() => expect(screen.getByText(/first failure/)).toBeInTheDocument())

    // Most of the first toast's life elapses.
    await act(async () => { vi.advanceTimersByTime(TOAST_MS - 500) })

    bridge.fail('open_recordings_folder', 'second failure')
    await user.click(folderButton())
    await waitFor(() => expect(screen.getByText(/second failure/)).toBeInTheDocument())

    // The first toast's original deadline passes; the second must survive it.
    await act(async () => { vi.advanceTimersByTime(1000) })
    expect(screen.getByText(/second failure/)).toBeInTheDocument()

    // And still disappear on its own schedule.
    await act(async () => { vi.advanceTimersByTime(TOAST_MS) })
    await waitFor(() => expect(screen.queryByText(/second failure/)).toBeNull())
  })

  it('cancels its timer when unmounted', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout')

    bridge.fail('open_recordings_folder', 'a failure')
    const view = render(<Toolbar />)
    await user.click(folderButton())
    await waitFor(() => expect(screen.getByText(/a failure/)).toBeInTheDocument())

    view.unmount()
    expect(clearSpy).toHaveBeenCalled()
  })
})
