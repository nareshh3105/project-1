// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'
import { installBridge, removeBridge, type BridgeStub } from '../mocks/bridge'
import { parseBrowser, pageKey, checkAddress, DEFAULT_BROWSER } from '../../src/lib/sources/browser'

/**
 * A web page in the scene: the settings are read defensively, a mistyped address
 * is explained as it is typed, and the preview shows what the main process paints
 * (or why it cannot).
 */

describe('browser settings', () => {
  it('start from sensible defaults', () => {
    expect(parseBrowser(undefined)).toEqual(DEFAULT_BROWSER)
  })

  it('keep valid choices', () => {
    expect(parseBrowser({ url: ' https://example.com ', width: 800, height: 600, fps: 15 }))
      .toEqual({ url: 'https://example.com', width: 800, height: 600, fps: 15 })
  })

  it.each([[1, 16], [99999, 4096], [NaN, 1280], ['wide', 1280], [800.4, 800]])('reads a width of %s as %s', (given, expected) => {
    expect(parseBrowser({ width: given }).width).toBe(expected)
  })

  it.each([[0, 1], [500, 60], [NaN, 30]])('reads a frame rate of %s as %s', (given, expected) => {
    expect(parseBrowser({ fps: given }).fps).toBe(expected)
  })

  it('ignores an address that is not text, and cuts an absurd one', () => {
    expect(parseBrowser({ url: 5 }).url).toBe('')
    expect(parseBrowser({ url: 'x'.repeat(5000) }).url).toHaveLength(2048)
  })

  it('has a page key that changes exactly when the page must start afresh', () => {
    const a = parseBrowser({ url: 'https://a.com' })
    expect(pageKey(a)).toBe(pageKey(parseBrowser({ url: 'https://a.com', junk: 1 })))
    expect(pageKey(a)).not.toBe(pageKey(parseBrowser({ url: 'https://b.com' })))
    expect(pageKey(a)).not.toBe(pageKey(parseBrowser({ url: 'https://a.com', width: 100 })))
    expect(pageKey(a)).not.toBe(pageKey(parseBrowser({ url: 'https://a.com', fps: 5 })))
  })
})

describe('checkAddress', () => {
  it.each([[''], ['   '], ['https://example.com'], ['http://localhost:3000'], ['example.com/page']])('has no complaint about %j', (a) => {
    expect(checkAddress(a)).toBeNull()
  })

  it.each([['file:///C:/x'], ['javascript:alert(1)'], ['ftp://example.com'], ['data:text/html,x']])('says only web addresses for %s', (a) => {
    expect(checkAddress(a)).toMatch(/Only web addresses/)
  })

  it('says when it cannot be read at all', () => {
    expect(checkAddress('http://')).toMatch(/not a valid/)
  })
})

describe('the page in the preview and in the properties', () => {
  let BrowserView: typeof import('../../src/components/studio/BrowserView')['BrowserView']
  let SourcePropertiesModal: typeof import('../../src/components/modals/SourcePropertiesModal')['SourcePropertiesModal']
  let useSourceStore: typeof import('../../src/stores/sourceStore')['useSourceStore']
  let useUIStore: typeof import('../../src/stores/uiStore')['useUIStore']
  let bridge: BridgeStub
  let frameListeners: Array<(...a: unknown[]) => void>
  let failureListeners: Array<(...a: unknown[]) => void>
  let drawn: unknown[][]

  const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  const calls = (name: string) => bridge.calls.filter((c) => c.command === name)

  beforeEach(async () => {
    vi.resetModules()
    localStorage.clear()
    bridge = installBridge()
    frameListeners = []; failureListeners = []; drawn = []
    // The bridge of the real preload can listen on fixed channels.
    ;(window as unknown as { codebuilders: Record<string, unknown> }).codebuilders.listen = (channel: string, cb: (...a: unknown[]) => void) => {
      const list = channel === 'cb:browser-frame' ? frameListeners : failureListeners
      list.push(cb)
      return () => { list.splice(list.indexOf(cb), 1) }
    }
    vi.stubGlobal('VideoFrame', class { constructor(public data: unknown, public init: unknown) {} close() {} })
    HTMLCanvasElement.prototype.getContext = (() => ({
      clearRect: () => {}, drawImage: (...a: unknown[]) => { drawn.push(a) },
    })) as never

    BrowserView = (await import('../../src/components/studio/BrowserView')).BrowserView
    SourcePropertiesModal = (await import('../../src/components/modals/SourcePropertiesModal')).SourcePropertiesModal
    useSourceStore = (await import('../../src/stores/sourceStore')).useSourceStore
    useUIStore = (await import('../../src/stores/uiStore')).useUIStore
  })
  afterEach(() => { cleanup(); removeBridge(); vi.unstubAllGlobals() })

  const view = (settings: Record<string, unknown>, id = 'b1') => render(<BrowserView sourceId={id} settings={settings} />)

  describe('the preview', () => {
    it('asks for an address before one is given, and starts nothing', async () => {
      view({})
      await settle()
      expect(screen.getByText('Enter a web address')).toBeInTheDocument()
      expect(calls('browser_attach')).toHaveLength(0)
    })

    it('asks the main process to run the page', async () => {
      view({ url: 'https://example.com', width: 800, height: 600, fps: 20 })
      await settle()
      expect(calls('browser_attach')[0].args).toEqual({ id: 'b1', url: 'https://example.com', width: 800, height: 600, fps: 20 })
    })

    it('says it is loading until the page has painted', async () => {
      view({ url: 'https://example.com' })
      await settle()
      expect(screen.getByText('Loading page…')).toBeInTheDocument()
    })

    it('draws a picture of its own page and then hides the note', async () => {
      view({ url: 'https://example.com' })
      await settle()
      await act(async () => { frameListeners.forEach((l) => l('b1', { width: 4, height: 2, x: 0, y: 0, w: 4, h: 2, bgra: new Uint8Array(32) })) })
      expect(drawn).toHaveLength(1)
      expect(screen.queryByText('Loading page…')).toBeNull()
    })

    it('ignores pictures of other pages', async () => {
      view({ url: 'https://example.com' })
      await settle()
      await act(async () => { frameListeners.forEach((l) => l('someone-else', { width: 4, height: 2, x: 0, y: 0, w: 4, h: 2, bgra: new Uint8Array(32) })) })
      expect(drawn).toHaveLength(0)
    })

    it('says why when the main process refuses the address', async () => {
      bridge.fail('browser_attach', 'Only web addresses starting with http:// or https:// can be used.')
      view({ url: 'file:///C:/x' })
      await settle()
      expect(screen.getByText(/Only web addresses/)).toBeInTheDocument()
    })

    it('says why when the page cannot be loaded', async () => {
      view({ url: 'https://example.com' })
      await settle()
      await act(async () => { failureListeners.forEach((l) => l('b1', 'The site refused the connection.')) })
      expect(screen.getByText('The site refused the connection.')).toBeInTheDocument()
    })

    it('does not start the page again for a change that does not matter to it', async () => {
      const { rerender } = view({ url: 'https://example.com' })
      await settle()
      rerender(<BrowserView sourceId="b1" settings={{ url: 'https://example.com', irrelevant: 1 }} />)
      await settle()
      expect(calls('browser_attach')).toHaveLength(1)
    })

    it('starts the new page when the address changes, letting the old one go', async () => {
      const { rerender } = view({ url: 'https://example.com' })
      await settle()
      rerender(<BrowserView sourceId="b1" settings={{ url: 'https://example.org' }} />)
      await settle()
      expect(calls('browser_attach')).toHaveLength(2)
      expect(calls('browser_detach')).toHaveLength(1)
    })

    it('lets go of the page when it is closed, and stops listening', async () => {
      const { unmount } = view({ url: 'https://example.com' })
      await settle()
      unmount()
      expect(calls('browser_detach')[0].args).toEqual({ id: 'b1' })
      expect(frameListeners).toHaveLength(0)
      expect(failureListeners).toHaveLength(0)
    })

    it('tells the caller how large the page is', async () => {
      const onSize = vi.fn()
      render(<BrowserView sourceId="b1" settings={{ url: 'https://example.com', width: 900, height: 500 }} onNaturalSize={onSize} />)
      await settle()
      expect(onSize).toHaveBeenCalledWith({ w: 900, h: 500 })
    })
  })

  describe('the properties', () => {
    const SCENE = 's1'
    const seed = (settings: Record<string, unknown> = {}) =>
      useSourceStore.setState({
        byScene: {
          [SCENE]: [{
            id: 'b1', sceneId: SCENE, name: 'Overlay', sourceType: 'browser_source', settings, orderIndex: 0, visible: true, locked: false,
            muted: false, volume: 1, transform: { x: 0, y: 0, width: 1280, height: 720, rotation: 0, scaleX: 1, scaleY: 1 },
            createdAt: 0, updatedAt: 0,
          }],
        } as never,
      })
    const open = async () => {
      render(<SourcePropertiesModal />)
      await act(async () => { useUIStore.getState().openModal('source-properties', { sceneId: SCENE, sourceId: 'b1' }) })
    }
    const saved = () => calls('update_source_settings')
    const lastSaved = () => JSON.parse(saved().at(-1)!.args.settings as string)

    it('starts from the saved page', async () => {
      seed({ url: 'https://example.com', width: 800, height: 450, fps: 24 })
      await open()
      expect(screen.getByLabelText('Address')).toHaveValue('https://example.com')
      expect(screen.getByLabelText('Page width')).toHaveValue(800)
      expect(screen.getByLabelText('Frame rate')).toHaveValue(24)
    })

    it('saves the address after a pause', async () => {
      seed()
      await open()
      vi.useFakeTimers()
      fireEvent.change(screen.getByLabelText('Address'), { target: { value: 'https://example.org/alerts' } })
      await act(async () => { vi.advanceTimersByTime(400) })
      vi.useRealTimers()
      expect(lastSaved().url).toBe('https://example.org/alerts')
    })

    it('says what is wrong with an address that cannot be used, as it is typed', async () => {
      seed()
      await open()
      fireEvent.change(screen.getByLabelText('Address'), { target: { value: 'file:///C:/x' } })
      expect(screen.getByRole('alert')).toHaveTextContent(/Only web addresses/)
    })

    it('has no complaint about a good address', async () => {
      seed({ url: 'https://example.com' })
      await open()
      expect(screen.queryByRole('alert')).toBeNull()
    })

    it('saves the size and frame rate', async () => {
      seed({ url: 'https://example.com' })
      await open()
      vi.useFakeTimers()
      fireEvent.change(screen.getByLabelText('Frame rate'), { target: { value: '10' } })
      await act(async () => { vi.advanceTimersByTime(400) })
      vi.useRealTimers()
      expect(lastSaved()).toMatchObject({ url: 'https://example.com', fps: 10 })
    })

    it('can refresh the page', async () => {
      seed({ url: 'https://example.com' })
      await open()
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh the page' })) })
      expect(calls('browser_reload')[0].args).toEqual({ id: 'b1' })
    })
  })
})
