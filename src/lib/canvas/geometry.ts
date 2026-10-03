import type { Transform } from '@/types'

/**
 * Placement maths for dragging and resizing a source on the scene canvas.
 *
 * Everything here works in canvas pixels. The canvas is drawn scaled to fit the
 * panel, so a pointer movement in screen pixels has to be divided by that scale
 * before it reaches these functions; otherwise a source would drift away from
 * the pointer at any size other than 1:1.
 *
 * Kept free of React so the edge cases can be tested directly.
 */

export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'

export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

/** A source can be made no smaller than this, in canvas pixels. */
export const MIN_SIZE = 16

/** The part of a placement a drag changes. */
export type Placement = Pick<Transform, 'x' | 'y' | 'width' | 'height'>

export const isCorner = (h: Handle): boolean => h.length === 2

/** Moves a source by `dx`, `dy` canvas pixels from where the drag began. */
export function moveBy(start: Placement, dx: number, dy: number): Pick<Transform, 'x' | 'y'> {
  return { x: Math.round(start.x + dx), y: Math.round(start.y + dy) }
}

interface ResizeOptions {
  /**
   * Keep the original proportions. Applies to corner handles only: an edge
   * handle moves a single edge, so there is no second axis to keep in step.
   */
  keepAspect?: boolean
}

/**
 * Resizes by dragging `handle` by `dx`, `dy` canvas pixels from where the drag
 * began. The edge or corner opposite the handle stays where it is.
 *
 * Dragging a handle past the far side stops at MIN_SIZE rather than flipping
 * the source inside out.
 */
export function resizeBy(
  start: Placement,
  handle: Handle,
  dx: number,
  dy: number,
  { keepAspect = false }: ResizeOptions = {},
): Placement {
  const west = handle.includes('w')
  const east = handle.includes('e')
  const north = handle.includes('n')
  const south = handle.includes('s')

  if (keepAspect && isCorner(handle)) {
    return resizeKeepingAspect(start, handle, dx, dy)
  }

  let left = start.x
  let top = start.y
  let right = start.x + start.width
  let bottom = start.y + start.height

  if (west) left += dx
  if (east) right += dx
  if (north) top += dy
  if (south) bottom += dy

  // Clamp the edge being dragged; the opposite one is the anchor.
  if (right - left < MIN_SIZE) {
    if (west) left = right - MIN_SIZE
    else right = left + MIN_SIZE
  }
  if (bottom - top < MIN_SIZE) {
    if (north) top = bottom - MIN_SIZE
    else bottom = top + MIN_SIZE
  }

  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.round(right - left),
    height: Math.round(bottom - top),
  }
}

function resizeKeepingAspect(start: Placement, handle: Handle, dx: number, dy: number): Placement {
  const west = handle.includes('w')
  const north = handle.includes('n')

  // Direction of growth on each axis: dragging a west handle left makes it wider.
  const growX = (west ? -dx : dx) / start.width
  const growY = (north ? -dy : dy) / start.height

  // Follow whichever axis the pointer has moved further, in relative terms, so
  // the source tracks the pointer instead of lagging on the smaller movement.
  let scale = 1 + (Math.abs(growX) >= Math.abs(growY) ? growX : growY)

  scale = Math.max(scale, MIN_SIZE / Math.min(start.width, start.height))

  const width = start.width * scale
  const height = start.height * scale

  // Pin the corner opposite the handle.
  const right = start.x + start.width
  const bottom = start.y + start.height
  const left = west ? right - width : start.x
  const top = north ? bottom - height : start.y

  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.round(width),
    height: Math.round(height),
  }
}

export type ArrowKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'

export const isArrowKey = (key: string): key is ArrowKey =>
  key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown'

/** One arrow press: 1 canvas pixel, or 10 with Shift. */
export function arrowStep(key: ArrowKey, shift: boolean): { dx: number; dy: number } {
  const step = shift ? 10 : 1
  switch (key) {
    case 'ArrowLeft':  return { dx: -step, dy: 0 }
    case 'ArrowRight': return { dx: step, dy: 0 }
    case 'ArrowUp':    return { dx: 0, dy: -step }
    case 'ArrowDown':  return { dx: 0, dy: step }
  }
}

/**
 * A screen-pixel movement expressed in canvas pixels, given the factor the
 * canvas is drawn at. A zero or invalid scale yields no movement rather than
 * Infinity, which would throw a source off the canvas.
 */
export function toCanvas(screenDelta: number, scale: number): number {
  return scale > 0 && Number.isFinite(scale) ? screenDelta / scale : 0
}
