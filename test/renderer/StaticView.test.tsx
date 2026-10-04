// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { installBridge, removeBridge, type BridgeStub } from '../mocks/bridge'

/** How a picture source looks in the preview: the picture, a prompt, or why it cannot be shown. */

let StaticView: typeof import('../../src/components/studio/StaticView')['StaticView']
let forgetPictures: typeof import('../../src/components/studio/StaticView')['forgetPictures']
let bridge: BridgeStub
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })

beforeEach(async () => {
  vi.resetModules()
  bridge = installBridge()
  const mod = await import('../../src/components/studio/StaticView')
  StaticView = mod.StaticView
  forgetPictures = mod.forgetPictures
  forgetPictures()
})
afterEach(() => { cleanup(); removeBridge() })

const view = (settings: Record<string, unknown>) =>
  render(<StaticView type="image" settings={settings} width={640} height={360} />)
const reads = () => bridge.calls.filter((c) => c.command === 'read_image_file')

describe('a picture', () => {
  it('asks for a picture before one is chosen, without reading anything', () => {
    view({})
    expect(screen.getByText('Choose a picture')).toBeInTheDocument()
    expect(reads()).toHaveLength(0)
  })

  it('shows the picture once it is read', async () => {
    bridge.reply('read_image_file', 'data:image/png;base64,AAAA')
    const { container } = view({ filePath: 'C:\a\b.png' })
    await settle()

    expect(container.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AAAA')
  })

  it('says why when it cannot be read', async () => {
    bridge.fail('read_image_file', 'The picture could not be found.')
    view({ filePath: 'C:\a\gone.png' })
    await settle()
    expect(screen.getByText(/could not be found/)).toBeInTheDocument()
  })

  it('refuses a file that is not a picture without asking the main process', async () => {
    view({ filePath: 'C:\a\run.exe' })
    await settle()
    expect(screen.getByText('That file is not a picture.')).toBeInTheDocument()
    expect(reads()).toHaveLength(0)
  })

  it('reads a file once, however often it is shown', async () => {
    bridge.reply('read_image_file', 'data:image/png;base64,AAAA')
    view({ filePath: 'C:\a\b.png' })
    await settle()
    cleanup()
    view({ filePath: 'C:\a\b.png' })
    await settle()
    expect(reads()).toHaveLength(1)
  })

  it('tries again after a failure, because the file may have been fixed', async () => {
    bridge.fail('read_image_file', 'gone')
    view({ filePath: 'C:\a\b.png' })
    await settle()
    cleanup()

    bridge.reply('read_image_file', 'data:image/png;base64,BBBB')
    ;(window as unknown as { codebuilders: { invoke: unknown } }).codebuilders.invoke =
      vi.fn(async () => 'data:image/png;base64,BBBB')
    const { container } = view({ filePath: 'C:\a\b.png' })
    await settle()
    expect(container.querySelector('img')).not.toBeNull()
  })
})

describe('color and text', () => {
  it('are drawn on a canvas of the source size', () => {
    const { container } = render(<StaticView type="color_source" settings={{ color: '#ff0000' }} width={300} height={120} />)
    const canvas = container.querySelector('canvas')!
    expect([canvas.width, canvas.height]).toEqual([300, 120])
  })

  it('keep the canvas inside sane limits', () => {
    const { container } = render(<StaticView type="text_gdi_plus" settings={{ text: 'x' }} width={99999} height={0} />)
    const canvas = container.querySelector('canvas')!
    expect([canvas.width, canvas.height]).toEqual([4096, 1])
  })
})
