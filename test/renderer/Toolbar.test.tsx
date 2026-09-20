// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installBridge, removeBridge, type BridgeStub } from '../mocks/bridge'

/**
 * Toolbar toasts are the only feedback for actions that report nothing else —
 * a screenshot that failed to save says so here or nowhere.
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

const screenshotButton = () => screen.getByRole('button', { name: /screenshot/i })

describe('transient feedback', () => {
  it('reports where a screenshot was saved', async () => {
    bridge.reply('take_screenshot', 'C:\\shots\\frame_01.png')
    render(<Toolbar />)

    await userEvent.click(screenshotButton())

    expect(await screen.findByText(/frame_01\.png/)).toBeInTheDocument()
  })

  it('surfaces a failure instead of staying silent', async () => {
    bridge.fail('take_screenshot', 'disk full')
    render(<Toolbar />)

    await userEvent.click(screenshotButton())

    expect(await screen.findByText(/disk full/)).toBeInTheDocument()
  })

  /**
   * The regression. The dismiss timer was never cancelled, so a second toast
   * inherited the first one's countdown: trigger one, wait three seconds,
   * trigger another, and the second vanished after half a second.
   */
  it('gives a second toast its own full duration', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    bridge.reply('take_screenshot', 'C:\\shots\\first.png')
    render(<Toolbar />)

    await user.click(screenshotButton())
    await waitFor(() => expect(screen.getByText(/first\.png/)).toBeInTheDocument())

    // Most of the first toast's life elapses.
    await act(async () => { vi.advanceTimersByTime(TOAST_MS - 500) })

    bridge.reply('take_screenshot', 'C:\\shots\\second.png')
    await user.click(screenshotButton())
    await waitFor(() => expect(screen.getByText(/second\.png/)).toBeInTheDocument())

    // The first toast's original deadline passes; the second must survive it.
    await act(async () => { vi.advanceTimersByTime(1000) })
    expect(screen.getByText(/second\.png/)).toBeInTheDocument()

    // And still disappear on its own schedule.
    await act(async () => { vi.advanceTimersByTime(TOAST_MS) })
    await waitFor(() => expect(screen.queryByText(/second\.png/)).toBeNull())
  })

  it('cancels its timer when unmounted', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout')

    bridge.reply('take_screenshot', 'C:\\shots\\frame.png')
    const view = render(<Toolbar />)
    await user.click(screenshotButton())
    await waitFor(() => expect(screen.getByText(/frame\.png/)).toBeInTheDocument())

    view.unmount()
    expect(clearSpy).toHaveBeenCalled()
  })
})
