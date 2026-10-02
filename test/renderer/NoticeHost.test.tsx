// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installBridge, removeBridge } from '../mocks/bridge'

let NoticeHost: typeof import('../../src/components/layout/NoticeHost')['NoticeHost']
let useNotifyStore: typeof import('../../src/stores/notifyStore')['useNotifyStore']

beforeEach(async () => {
  vi.resetModules()
  installBridge()
  NoticeHost = (await import('../../src/components/layout/NoticeHost')).NoticeHost
  useNotifyStore = (await import('../../src/stores/notifyStore')).useNotifyStore
})

afterEach(() => {
  cleanup()
  removeBridge()
  vi.useRealTimers()
})

const notify = (kind: 'error' | 'info', message: string) =>
  act(() => { useNotifyStore.getState().notify(kind, message) })

describe('notice host', () => {
  it('renders nothing when there is nothing to say', () => {
    const { container } = render(<NoticeHost />)
    expect(container).toBeEmptyDOMElement()
  })

  it('announces an error as an alert', () => {
    render(<NoticeHost />)
    notify('error', "Couldn't add the scene: disk full")

    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't add the scene: disk full")
  })

  it('announces information politely', () => {
    render(<NoticeHost />)
    notify('info', 'Saved')

    expect(screen.getByRole('status')).toHaveTextContent('Saved')
  })

  it('dismisses on request', async () => {
    render(<NoticeHost />)
    notify('error', 'Something failed')

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('removes an error by itself after a while', () => {
    vi.useFakeTimers()
    render(<NoticeHost />)
    notify('error', 'Something failed')

    act(() => { vi.advanceTimersByTime(7000) })
    expect(screen.getByRole('alert')).toBeInTheDocument()

    act(() => { vi.advanceTimersByTime(2000) })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('lets information go sooner than an error', () => {
    vi.useFakeTimers()
    render(<NoticeHost />)
    notify('info', 'Saved')

    act(() => { vi.advanceTimersByTime(4500) })

    expect(screen.queryByRole('status')).toBeNull()
  })

  it('shows several at once', () => {
    render(<NoticeHost />)
    notify('error', 'First')
    notify('error', 'Second')

    expect(screen.getAllByRole('alert')).toHaveLength(2)
  })
})
