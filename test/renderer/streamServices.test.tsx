// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installBridge, removeBridge, type BridgeStub } from '../mocks/bridge'
import { STREAM_SERVICES, serviceOf, serviceById } from '../../src/lib/streamServices'

/**
 * Stream Settings offers YouTube and Twitch by name, so that nobody has to know
 * their server addresses; anything else is a custom RTMP server.
 */

describe('the services', () => {
  it('has YouTube with its real server address', () => {
    expect(serviceById('youtube').url).toBe('rtmp://a.rtmp.youtube.com/live2')
  })

  it('has Twitch with its real server address', () => {
    expect(serviceById('twitch').url).toBe('rtmp://live.twitch.tv/app')
  })

  it('has a custom choice with no address of its own', () => {
    expect(serviceById('custom').url).toBe('')
  })

  it('tells where to find the stream key for each', () => {
    for (const s of STREAM_SERVICES) expect(s.keyHelp.length).toBeGreaterThan(20)
    expect(serviceById('youtube').keyHelp).toMatch(/YouTube Studio/)
  })
})

describe('serviceOf', () => {
  it.each([
    ['rtmp://a.rtmp.youtube.com/live2', 'youtube'],
    ['rtmp://a.rtmp.youtube.com/live2/', 'youtube'],
    ['  RTMP://A.RTMP.YOUTUBE.COM/LIVE2  ', 'youtube'],
    ['rtmp://live.twitch.tv/app', 'twitch'],
    ['rtmp://live.example.com/app', 'custom'],
    ['rtmp://b.rtmp.youtube.com/live2?backup=1', 'custom'],
    ['', 'custom'],
    ['   ', 'custom'],
  ])('reads %j as %s', (url, expected) => {
    expect(serviceOf(url)).toBe(expected)
  })
})

describe('the Stream Settings window', () => {
  let bridge: BridgeStub
  let StreamSettingsModal: typeof import('../../src/components/modals/StreamSettingsModal')['StreamSettingsModal']
  let useUIStore: typeof import('../../src/stores/uiStore')['useUIStore']

  async function mount(saved?: { rtmpUrl: string; streamKey: string }) {
    if (saved) localStorage.setItem('cb:stream', JSON.stringify(saved))
    StreamSettingsModal = (await import('../../src/components/modals/StreamSettingsModal')).StreamSettingsModal
    useUIStore = (await import('../../src/stores/uiStore')).useUIStore
    render(<StreamSettingsModal />)
    await act(async () => { useUIStore.getState().openModal('stream-settings') })
    await screen.findByLabelText(/show stream key/i)
  }

  const service = () => screen.getByLabelText('Service') as HTMLSelectElement
  const urlBox = () => screen.queryByLabelText('RTMP URL') as HTMLInputElement | null

  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
    bridge = installBridge()
  })
  afterEach(() => { cleanup(); removeBridge() })

  it('starts on Custom, with the address box, when nothing is saved', async () => {
    await mount()
    expect(service().value).toBe('custom')
    expect(urlBox()).not.toBeNull()
  })

  it('shows a saved YouTube address as YouTube, without the address box', async () => {
    await mount({ rtmpUrl: 'rtmp://a.rtmp.youtube.com/live2', streamKey: 'abcd-1234' })
    expect(service().value).toBe('youtube')
    expect(urlBox()).toBeNull()
  })

  it('shows where to find the YouTube key when YouTube is chosen', async () => {
    await mount()
    await userEvent.selectOptions(service(), 'youtube')
    expect(screen.getByText(/YouTube Studio/)).toBeInTheDocument()
  })

  it('goes live to YouTube with its address and the key typed', async () => {
    await mount()
    await userEvent.selectOptions(service(), 'youtube')
    await userEvent.type(screen.getByLabelText('Stream Key'), 'abcd-efgh-ijkl')
    await userEvent.click(screen.getByRole('button', { name: /go live/i }))

    await vi.waitFor(() => expect(bridge.argsFor('start_streaming')).toMatchObject({
      rtmpUrl: 'rtmp://a.rtmp.youtube.com/live2', streamKey: 'abcd-efgh-ijkl',
    }))
  })

  it('remembers the choice for next time', async () => {
    await mount()
    await userEvent.selectOptions(service(), 'twitch')
    await userEvent.type(screen.getByLabelText('Stream Key'), 'live_x')
    await userEvent.click(screen.getByRole('button', { name: /go live/i }))
    await vi.waitFor(() => expect(JSON.parse(localStorage.getItem('cb:stream')!)).toMatchObject({ rtmpUrl: 'rtmp://live.twitch.tv/app' }))
  })

  it('switching to Custom brings the address box back, empty if it held a service address', async () => {
    await mount({ rtmpUrl: 'rtmp://a.rtmp.youtube.com/live2', streamKey: '' })
    await userEvent.selectOptions(service(), 'custom')
    expect(urlBox()).not.toBeNull()
    expect(urlBox()!.value).toBe('')
  })

  it('keeps a custom address that was typed', async () => {
    await mount({ rtmpUrl: 'rtmp://live.example.com/app', streamKey: '' })
    expect(service().value).toBe('custom')
    expect(urlBox()!.value).toBe('rtmp://live.example.com/app')
  })

  it('asks for an address when Custom has none', async () => {
    await mount()
    await userEvent.click(screen.getByRole('button', { name: /go live/i }))
    expect(await screen.findByText('RTMP URL is required')).toBeInTheDocument()
    expect(bridge.argsFor('start_streaming')).toBeUndefined()
  })
})
