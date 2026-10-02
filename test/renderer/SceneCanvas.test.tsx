// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { installBridge, removeBridge } from '../mocks/bridge'

/**
 * The empty preview is the first thing a new user sees, and its hint is the
 * only instruction on screen. It was drawn as muted grey at 15–25% opacity on
 * black — roughly 1.1:1 contrast, which is to say invisible.
 */

let SceneCanvas: typeof import('../../src/components/studio/SceneCanvas')['SceneCanvas']

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  installBridge()
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  SceneCanvas = (await import('../../src/components/studio/SceneCanvas')).SceneCanvas
})

afterEach(() => {
  cleanup()
  removeBridge()
  vi.unstubAllGlobals()
})

/** Tailwind opacity utilities (`opacity-25`) on the element or an ancestor up to the root. */
function dimmedBelow(el: HTMLElement, percent: number): boolean {
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    const match = /(?:^|\s)opacity-(\d+)(?:\s|$)/.exec(node.className)
    if (match && Number(match[1]) < percent) return true
  }
  return false
}

describe('empty preview hint', () => {
  it('tells the user what to do', () => {
    render(<SceneCanvas sceneId={null} />)

    expect(screen.getByText('No active capture')).toBeInTheDocument()
    expect(screen.getByText(/add a display capture or window capture/i)).toBeInTheDocument()
  })

  it('is not dimmed into illegibility', () => {
    render(<SceneCanvas sceneId={null} />)

    for (const text of [/no active capture/i, /add a display capture/i]) {
      expect(dimmedBelow(screen.getByText(text), 60)).toBe(false)
    }
  })

  it('stays out of the way of thumbnails', () => {
    render(<SceneCanvas sceneId={null} showPlaceholder={false} />)
    expect(screen.queryByText('No active capture')).toBeNull()
  })
})
