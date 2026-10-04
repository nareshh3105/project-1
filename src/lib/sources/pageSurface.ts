import type { PageUpdate } from '../../../shared/host'

/**
 * The picture of a web page, kept on a canvas and updated region by region.
 *
 * A page sends only what changed, so the canvas holds the rest. The same code
 * serves the preview and the recorder, so they show the same page.
 */

/** The part of a 2D context this uses. */
export interface SurfaceContext {
  clearRect(x: number, y: number, w: number, h: number): void
  drawImage(image: CanvasImageSource, dx: number, dy: number): void
}

export interface Surface {
  readonly canvas: HTMLCanvasElement
  readonly width: number
  readonly height: number
  draw(update: PageUpdate): void
}

/**
 * Puts a changed region onto a canvas, replacing what was there. Replacing, not
 * blending: a region that has become more transparent must not keep the old
 * picture showing through.
 */
export function paintUpdate(ctx: SurfaceContext, update: PageUpdate): void {
  const frame = new VideoFrame(update.bgra as BufferSource, {
    // Raw pixels from the page, as the browser makes them: blue, green, red, alpha.
    format: 'BGRA', codedWidth: update.w, codedHeight: update.h, timestamp: 0,
  })
  try {
    ctx.clearRect(update.x, update.y, update.w, update.h)
    ctx.drawImage(frame, update.x, update.y)
  } finally {
    frame.close()
  }
}

/** Whether a region is something that can be painted. */
export function isPaintable(u: PageUpdate): boolean {
  return u.width > 0 && u.height > 0 && u.w > 0 && u.h > 0 && u.bgra.length === u.w * u.h * 4
    && u.x >= 0 && u.y >= 0 && u.x + u.w <= u.width && u.y + u.h <= u.height
}

export function createSurface(width: number, height: number): Surface {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not create a drawing surface for the page.')

  return {
    canvas, width, height,
    draw: (update) => { if (isPaintable(update)) paintUpdate(ctx, update) },
  }
}
