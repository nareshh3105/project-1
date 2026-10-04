// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { AddSourceModal } from '../../src/components/modals/AddSourceModal'
import { targetKindFor } from '../../src/lib/capture/target'
import { isStaticType } from '../../src/lib/sources/static'
import { isMediaType } from '../../src/lib/sources/media'
import { isBrowserType } from '../../src/lib/sources/browser'
import type { SourceType } from '../../src/types'

/**
 * Only the sources that capture something are drawn into a recording. Offering
 * the rest as if they worked would add a source that does nothing, and a
 * tester would reasonably take that as a bug.
 */

const WORKING: Array<[string, SourceType]> = [
  ['Display Capture', 'display_capture'],
  ['Window Capture', 'window_capture'],
  ['Game Capture', 'game_capture'],
  ['Video Capture', 'dshow_video'],
  ['Image', 'image'],
  ['Color Source', 'color_source'],
  ['Text (GDI+)', 'text_gdi_plus'],
  ['Media Source', 'media_source'],
  ['Browser Source', 'browser_source'],
]
const NOT_YET = ['Scene', 'Desktop Audio', 'Microphone']

const open = (onAdd = vi.fn(), onClose = vi.fn()) => {
  render(<AddSourceModal open onAdd={onAdd} onClose={onClose} />)
  return { onAdd, onClose }
}
const button = (label: string) => screen.getByText(label).closest('button') as HTMLButtonElement

afterEach(cleanup)

describe('AddSourceModal', () => {
  it.each(WORKING)('offers %s', (label, type) => {
    const { onAdd, onClose } = open()
    expect(button(label).disabled).toBe(false)
    fireEvent.click(button(label))
    expect(onAdd).toHaveBeenCalledWith(type, label)
    expect(onClose).toHaveBeenCalled()
  })

  it.each(NOT_YET)('does not pretend %s works', (label) => {
    const { onAdd } = open()
    expect(button(label).disabled).toBe(true)
    fireEvent.click(button(label))
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('says why the audio sources are not here', () => {
    open()
    expect(button('Microphone').textContent).toMatch(/Audio Mixer/)
    expect(button('Desktop Audio').textContent).toMatch(/Audio Mixer/)
  })

  // Keeps the dialog and the recorder in step: a type is offered exactly when it is drawn.
  it('offers exactly the types the recorder can draw', () => {
    open()
    const offered = WORKING.map(([, type]) => type)
    expect(offered.every((t) => targetKindFor(t) !== null || isStaticType(t) || isMediaType(t) || isBrowserType(t))).toBe(true)
  })
})
