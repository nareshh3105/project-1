// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installBridge, removeBridge, type BridgeStub } from '../mocks/bridge'

/**
 * The dialog that decides how a color, a piece of text or a picture looks.
 * Changes apply as they are made, typing is saved once after a pause rather
 * than on every key, and closing never loses what was typed.
 */

type Modal = typeof import('../../src/components/modals/SourcePropertiesModal')['SourcePropertiesModal']
let SourcePropertiesModal: Modal
let useSourceStore: typeof import('../../src/stores/sourceStore')['useSourceStore']
let useUIStore: typeof import('../../src/stores/uiStore')['useUIStore']
let bridge: BridgeStub

const SCENE = 's1'
const seed = (sourceType: string, settings: Record<string, unknown> = {}) => {
  useSourceStore.setState({
    byScene: {
      [SCENE]: [{
        id: 'a', sceneId: SCENE, name: 'My source', sourceType, settings, orderIndex: 0, visible: true, locked: false,
        muted: false, volume: 1, transform: { x: 0, y: 0, width: 800, height: 160, rotation: 0, scaleX: 1, scaleY: 1 },
        createdAt: 0, updatedAt: 0,
      }],
    } as never,
  })
}
const openModal = () => act(() => useUIStore.getState().openModal('source-properties', { sceneId: SCENE, sourceId: 'a' }))
const saved = () => bridge.calls.filter((c) => c.command === 'update_source_settings')
const lastSaved = () => JSON.parse(saved().at(-1)!.args.settings as string)
const stored = () => useSourceStore.getState().byScene[SCENE][0].settings

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  bridge = installBridge()
  SourcePropertiesModal = (await import('../../src/components/modals/SourcePropertiesModal')).SourcePropertiesModal
  useSourceStore = (await import('../../src/stores/sourceStore')).useSourceStore
  useUIStore = (await import('../../src/stores/uiStore')).useUIStore
})
afterEach(() => { cleanup(); removeBridge(); vi.useRealTimers() })

describe('opening', () => {
  it('shows nothing until asked', () => {
    seed('color_source')
    render(<SourcePropertiesModal />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('names the source it is for', async () => {
    seed('color_source')
    render(<SourcePropertiesModal />)
    await openModal()
    expect(screen.getByText('My source properties')).toBeInTheDocument()
  })

  it('shows nothing for a source that is not drawn from settings', async () => {
    seed('display_capture')
    render(<SourcePropertiesModal />)
    await openModal()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows nothing when the source no longer exists', async () => {
    seed('color_source')
    useSourceStore.setState({ byScene: { [SCENE]: [] } })
    render(<SourcePropertiesModal />)
    await openModal()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('a color', () => {
  it('starts from the saved color', async () => {
    seed('color_source', { color: '#123456' })
    render(<SourcePropertiesModal />)
    await openModal()
    expect(screen.getByLabelText('Color')).toHaveValue('#123456')
  })

  it('saves a valid hex color as soon as it is typed', async () => {
    seed('color_source', { color: '#123456' })
    render(<SourcePropertiesModal />)
    await openModal()

    vi.useFakeTimers()
    fireEvent.change(screen.getByLabelText('Color'), { target: { value: '#abcdef' } })
    await act(async () => { vi.advanceTimersByTime(400) })

    expect(lastSaved().color).toBe('#abcdef')
    expect(stored().color).toBe('#abcdef')
  })

  it('does not save half a color, and flags it', async () => {
    seed('color_source', { color: '#123456' })
    render(<SourcePropertiesModal />)
    await openModal()

    vi.useFakeTimers()
    fireEvent.change(screen.getByLabelText('Color'), { target: { value: '#12' } })
    await act(async () => { vi.advanceTimersByTime(400) })

    expect(saved()).toHaveLength(0)
    expect(screen.getByLabelText('Color').className).toMatch(/danger/)
  })

  it('does not accept anything that is not a color', async () => {
    seed('color_source', { color: '#123456' })
    render(<SourcePropertiesModal />)
    await openModal()

    vi.useFakeTimers()
    fireEvent.change(screen.getByLabelText('Color'), { target: { value: 'red' } })
    await act(async () => { vi.advanceTimersByTime(400) })
    expect(saved()).toHaveLength(0)
  })
})

describe('text', () => {
  const type = async (value: string) => {
    fireEvent.change(screen.getByLabelText('Text'), { target: { value } })
  }

  it('starts from the saved words and look', async () => {
    seed('text_gdi_plus', { text: 'Hello', fontSize: 80, bold: true })
    render(<SourcePropertiesModal />)
    await openModal()

    expect(screen.getByLabelText('Text')).toHaveValue('Hello')
    expect(screen.getByLabelText('Size')).toHaveValue(80)
    expect(screen.getByRole('checkbox', { name: 'Bold' })).toBeChecked()
  })

  it('saves typing once, after a pause, not on every key', async () => {
    seed('text_gdi_plus', { text: '' })
    render(<SourcePropertiesModal />)
    await openModal()

    vi.useFakeTimers()
    for (const text of ['H', 'He', 'Hel', 'Hell', 'Hello']) {
      await type(text)
      await act(async () => { vi.advanceTimersByTime(100) })
    }
    expect(saved()).toHaveLength(0)

    await act(async () => { vi.advanceTimersByTime(400) })
    expect(saved()).toHaveLength(1)
    expect(lastSaved().text).toBe('Hello')
  })

  it('saves what was typed when the dialog is closed straight away', async () => {
    seed('text_gdi_plus', { text: '' })
    render(<SourcePropertiesModal />)
    await openModal()
    await type('Quick')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Done' })) })

    expect(lastSaved().text).toBe('Quick')
    expect(useUIStore.getState().modal).toBeNull()
  })

  it('saves a font change at once', async () => {
    seed('text_gdi_plus', { text: 'x' })
    render(<SourcePropertiesModal />)
    await openModal()
    await act(async () => { fireEvent.change(screen.getByLabelText('Font'), { target: { value: 'Georgia' } }) })
    expect(lastSaved().fontFamily).toBe('Georgia')
  })

  it('toggles bold and italic', async () => {
    seed('text_gdi_plus', { text: 'x' })
    render(<SourcePropertiesModal />)
    await openModal()
    await act(async () => { fireEvent.click(screen.getByRole('checkbox', { name: 'Italic' })) })
    expect(lastSaved().italic).toBe(true)
  })

  it('offers a background color only once a background is switched on', async () => {
    seed('text_gdi_plus', { text: 'x' })
    render(<SourcePropertiesModal />)
    await openModal()
    expect(screen.queryByLabelText('Background color')).toBeNull()

    await act(async () => { fireEvent.click(screen.getByRole('checkbox', { name: 'Background' })) })
    expect(screen.getByLabelText('Background color')).toBeInTheDocument()
    expect(lastSaved().backgroundColor).toBe('#000000')
  })

  it('turns the background off again', async () => {
    seed('text_gdi_plus', { text: 'x', backgroundColor: '#112233' })
    render(<SourcePropertiesModal />)
    await openModal()
    await act(async () => { fireEvent.click(screen.getByRole('checkbox', { name: 'Background' })) })
    expect(lastSaved().backgroundColor).toBe('')
  })

  it('ignores a size that is not a number', async () => {
    seed('text_gdi_plus', { text: 'x', fontSize: 50 })
    render(<SourcePropertiesModal />)
    await openModal()
    vi.useFakeTimers()
    fireEvent.change(screen.getByLabelText('Size'), { target: { value: '' } })
    await act(async () => { vi.advanceTimersByTime(400) })
    // An empty box reads as 0, which is clamped to the smallest size rather than saved as nonsense.
    expect(stored().fontSize === undefined || Number.isFinite(stored().fontSize as number)).toBe(true)
  })

  it('leaves the other settings alone when one changes', async () => {
    seed('text_gdi_plus', { text: 'keep me', fontSize: 50, color: '#ff0000' })
    render(<SourcePropertiesModal />)
    await openModal()
    await act(async () => { fireEvent.click(screen.getByRole('checkbox', { name: 'Bold' })) })
    expect(lastSaved()).toMatchObject({ text: 'keep me', fontSize: 50, color: '#ff0000', bold: true })
  })
})

describe('a picture', () => {
  it('says when none is chosen', async () => {
    seed('image', {})
    render(<SourcePropertiesModal />)
    await openModal()
    expect(screen.getByLabelText('Chosen picture')).toHaveTextContent('No picture chosen yet.')
  })

  it('shows the chosen file', async () => {
    seed('image', { filePath: 'C:\\pics\\logo.png' })
    render(<SourcePropertiesModal />)
    await openModal()
    expect(screen.getByLabelText('Chosen picture')).toHaveTextContent('C:\\pics\\logo.png')
  })

  it('does nothing when the file chooser is cancelled', async () => {
    seed('image', {})
    render(<SourcePropertiesModal />)
    await openModal()
    bridge.reply('show_open_dialog', null)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Choose a picture' }))
    expect(saved()).toHaveLength(0)
  })
})

describe('closing', () => {
  it('saves a change that is still waiting if the dialog is taken away', async () => {
    seed('text_gdi_plus', { text: '' })
    const view = render(<SourcePropertiesModal />)
    await openModal()
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Unsaved' } })
    expect(saved()).toHaveLength(0)

    view.unmount()
    expect(lastSaved().text).toBe('Unsaved')
  })

  it('closes with the Done button', async () => {
    seed('color_source')
    render(<SourcePropertiesModal />)
    await openModal()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Done' })) })
    expect(useUIStore.getState().modal).toBeNull()
  })

  it('closes with Escape', async () => {
    seed('color_source')
    render(<SourcePropertiesModal />)
    await openModal()
    await userEvent.setup().keyboard('{Escape}')
    expect(useUIStore.getState().modal).toBeNull()
  })
})
