// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installBridge, removeBridge, type BridgeStub } from '../mocks/bridge'

/**
 * Choosing a video or sound file, and seeing it in the preview. A file that
 * cannot be played must be refused with a reason, not kept and left to fail
 * quietly in the middle of a recording.
 */

let SourcePropertiesModal: typeof import('../../src/components/modals/SourcePropertiesModal')['SourcePropertiesModal']
let MediaView: typeof import('../../src/components/studio/MediaView')['MediaView']
let useSourceStore: typeof import('../../src/stores/sourceStore')['useSourceStore']
let useUIStore: typeof import('../../src/stores/uiStore')['useUIStore']
let bridge: BridgeStub

const SCENE = 's1'
const seed = (settings: Record<string, unknown> = {}) =>
  useSourceStore.setState({
    byScene: {
      [SCENE]: [{
        id: 'a', sceneId: SCENE, name: 'Clip', sourceType: 'media_source', settings, orderIndex: 0, visible: true, locked: false,
        muted: false, volume: 1, transform: { x: 0, y: 0, width: 1280, height: 720, rotation: 0, scaleX: 1, scaleY: 1 },
        createdAt: 0, updatedAt: 0,
      }],
    } as never,
  })
const openDialog = () => act(() => useUIStore.getState().openModal('source-properties', { sceneId: SCENE, sourceId: 'a' }))
const saved = () => bridge.calls.filter((c) => c.command === 'update_source_settings')
const lastSaved = () => JSON.parse(saved().at(-1)!.args.settings as string)
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })

/** Stands in for the video element's loading, which jsdom does not do. */
function stubVideo(outcome: { width: number; height: number } | { errorCode: number }) {
  const real = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    const el = real(tag) as HTMLVideoElement
    if (tag !== 'video') return el
    let source = ''
    Object.defineProperty(el, 'src', { get: () => source, set: (v: string) => {
      source = v
      queueMicrotask(() => {
        if ('errorCode' in outcome) {
          Object.defineProperty(el, 'error', { value: { code: outcome.errorCode }, configurable: true })
          el.onerror?.(new Event('error'))
        } else {
          Object.defineProperty(el, 'videoWidth', { value: outcome.width, configurable: true })
          Object.defineProperty(el, 'videoHeight', { value: outcome.height, configurable: true })
          el.onloadedmetadata?.(new Event('loadedmetadata'))
        }
      })
    } })
    return el
  }) as typeof document.createElement)
}

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  bridge = installBridge()
  bridge.reply('media_url', 'cbmedia://media/abc')
  SourcePropertiesModal = (await import('../../src/components/modals/SourcePropertiesModal')).SourcePropertiesModal
  MediaView = (await import('../../src/components/studio/MediaView')).MediaView
  useSourceStore = (await import('../../src/stores/sourceStore')).useSourceStore
  useUIStore = (await import('../../src/stores/uiStore')).useUIStore
})
afterEach(() => { cleanup(); removeBridge(); vi.restoreAllMocks() })

describe('the properties of a media source', () => {
  it('shows nothing chosen at first', async () => {
    seed()
    render(<SourcePropertiesModal />)
    await openDialog()
    expect(screen.getByLabelText('Chosen file')).toHaveTextContent('No file chosen yet.')
  })

  it('shows the name of the file, not its whole path', async () => {
    seed({ filePath: String.raw`C:\videos\holiday.mp4` })
    render(<SourcePropertiesModal />)
    await openDialog()
    expect(screen.getByLabelText('Chosen file')).toHaveTextContent('holiday.mp4')
  })

  it('starts from the saved options', async () => {
    seed({ filePath: 'x.mp4', loop: false, muted: true, volume: 0.4 })
    render(<SourcePropertiesModal />)
    await openDialog()
    expect(screen.getByRole('checkbox', { name: 'Loop' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Mute sound' })).toBeChecked()
    expect(screen.getByLabelText('Volume')).toHaveValue('40')
  })

  it('saves loop and mute at once, and keeps the rest', async () => {
    seed({ filePath: 'x.mp4', volume: 0.5 })
    render(<SourcePropertiesModal />)
    await openDialog()
    await act(async () => { fireEvent.click(screen.getByRole('checkbox', { name: 'Mute sound' })) })
    expect(lastSaved()).toMatchObject({ filePath: 'x.mp4', volume: 0.5, muted: true })
  })

  it('saves a volume as a share of one, after a pause', async () => {
    seed({ filePath: 'x.mp4' })
    render(<SourcePropertiesModal />)
    await openDialog()
    vi.useFakeTimers()
    fireEvent.change(screen.getByLabelText('Volume'), { target: { value: '35' } })
    await act(async () => { vi.advanceTimersByTime(400) })
    vi.useRealTimers()
    expect(lastSaved().volume).toBe(0.35)
  })

  describe('choosing a file', () => {
    const choose = async () => {
      await openDialog()
      await userEvent.setup().click(screen.getByRole('button', { name: 'Choose a file' }))
      await settle()
      await settle()
    }

    it('keeps a file that plays, and sizes the source to its picture', async () => {
      seed()
      bridge.reply('show_open_dialog', String.raw`C:\v\clip.mp4`)
      stubVideo({ width: 640, height: 360 })
      render(<SourcePropertiesModal />)
      await choose()

      expect(lastSaved().filePath).toBe(String.raw`C:\v\clip.mp4`)
      const t = useSourceStore.getState().byScene[SCENE][0].transform
      expect([t.width, t.height]).toEqual([640, 360])
    })

    it('keeps a sound file, leaving the size alone', async () => {
      seed()
      bridge.reply('show_open_dialog', String.raw`C:\v\song.mp3`)
      stubVideo({ width: 0, height: 0 })
      render(<SourcePropertiesModal />)
      await choose()

      expect(lastSaved().filePath).toBe(String.raw`C:\v\song.mp3`)
      expect(useSourceStore.getState().byScene[SCENE][0].transform.width).toBe(1280)
    })

    it('refuses a file that cannot be played, with a reason, and keeps nothing', async () => {
      seed()
      bridge.reply('show_open_dialog', String.raw`C:\v\old.avi`)
      stubVideo({ errorCode: 4 })
      render(<SourcePropertiesModal />)
      await choose()

      expect(saved()).toHaveLength(0)
      const { useNotifyStore } = await import('../../src/stores/notifyStore')
      expect(useNotifyStore.getState().notices.at(-1)?.message).toMatch(/cannot be played/)
    })

    it('refuses a file the main process will not serve', async () => {
      seed()
      bridge.reply('show_open_dialog', String.raw`C:\v\notes.txt`)
      bridge.fail('media_url', 'That is not a video or sound file the app can play.')
      render(<SourcePropertiesModal />)
      await choose()

      expect(saved()).toHaveLength(0)
    })

    it('does nothing when the chooser is cancelled', async () => {
      seed()
      bridge.reply('show_open_dialog', null)
      render(<SourcePropertiesModal />)
      await choose()
      expect(saved()).toHaveLength(0)
      expect(bridge.calls.filter((c) => c.command === 'media_url')).toHaveLength(0)
    })

    it('offers only video and sound files in the chooser', async () => {
      seed()
      bridge.reply('show_open_dialog', null)
      render(<SourcePropertiesModal />)
      await choose()
      const filters = bridge.argsFor('show_open_dialog')!.filters as Array<{ extensions: string[] }>
      expect(filters[0].extensions).toEqual(expect.arrayContaining(['mp4', 'webm', 'mp3', 'wav']))
      expect(filters[0].extensions).not.toContain('exe')
    })
  })
})

describe('the media preview', () => {
  const view = (settings: Record<string, unknown>) => render(<MediaView settings={settings} />)

  it('asks for a file before one is chosen, without asking the main process for anything', () => {
    view({})
    expect(screen.getByText('Choose a video or sound file')).toBeInTheDocument()
    expect(bridge.calls.filter((c) => c.command === 'media_url')).toHaveLength(0)
  })

  it('plays the file silently, because the recorder mixes the sound itself', async () => {
    const { container } = view({ filePath: 'x.mp4' })
    await settle()
    const video = container.querySelector('video')!
    expect(video.getAttribute('src')).toBe('cbmedia://media/abc')
    expect(video.muted).toBe(true)
    expect(video.autoplay).toBe(true)
  })

  it('loops unless told not to', async () => {
    const a = view({ filePath: 'x.mp4' })
    await settle()
    expect(a.container.querySelector('video')!.loop).toBe(true)
    cleanup()
    const b = view({ filePath: 'x.mp4', loop: false })
    await settle()
    expect(b.container.querySelector('video')!.loop).toBe(false)
  })

  it('says why when the file cannot be served', async () => {
    bridge.fail('media_url', 'The file could not be found. It may have been moved or deleted.')
    view({ filePath: 'gone.mp4' })
    await settle()
    expect(screen.getByText(/could not be found/)).toBeInTheDocument()
  })

  it('says what to try when the player cannot decode it', async () => {
    const { container } = view({ filePath: 'x.mkv' })
    await settle()
    const video = container.querySelector('video')!
    Object.defineProperty(video, 'error', { value: { code: 4 }, configurable: true })
    await act(async () => { fireEvent.error(video) })
    expect(screen.getByText(/MP4/)).toBeInTheDocument()
  })

  it('tells the caller the size of the picture once it is known', async () => {
    const onSize = vi.fn()
    const { container } = render(<MediaView settings={{ filePath: 'x.mp4' }} onNaturalSize={onSize} />)
    await settle()
    const video = container.querySelector('video')!
    Object.defineProperty(video, 'videoWidth', { value: 1280, configurable: true })
    Object.defineProperty(video, 'videoHeight', { value: 720, configurable: true })
    await act(async () => { fireEvent.loadedMetadata(video) })
    expect(onSize).toHaveBeenLastCalledWith({ w: 1280, h: 720 })
  })

  it('hides the picture of a sound file instead of showing a black box', async () => {
    const { container } = view({ filePath: 'song.mp3' })
    await settle()
    const video = container.querySelector('video')!
    Object.defineProperty(video, 'videoWidth', { value: 0, configurable: true })
    await act(async () => { fireEvent.loadedMetadata(video) })
    expect(video.className).toMatch(/opacity-0/)
  })
})
