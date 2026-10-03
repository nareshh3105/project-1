import type { SnapshotTransform } from '../../shared/host'

/**
 * Where each source lands in the output frame.
 *
 * The interface previews the scene with ordinary DOM elements: a box at the
 * source's position and size, turned and scaled about its centre, with the
 * picture inside it fitted by `object-fit: contain`. The output has to put the
 * same pixels in the same places, or what the user arranges is not what they
 * record. These functions are that rule, written once for the canvas.
 */

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * The largest rectangle with the source's proportions that fits inside the
 * destination, centred in it. Matches CSS `object-fit: contain`.
 * A source with no size fills the destination rather than vanishing.
 */
export function fitContain(srcW: number, srcH: number, dstW: number, dstH: number): Rect {
  if (!(srcW > 0) || !(srcH > 0) || !(dstW > 0) || !(dstH > 0)) {
    return { x: 0, y: 0, w: Math.max(0, dstW), h: Math.max(0, dstH) }
  }

  const scale = Math.min(dstW / srcW, dstH / srcH)
  const w = srcW * scale
  const h = srcH * scale
  return { x: (dstW - w) / 2, y: (dstH - h) / 2, w, h }
}

export interface OutputMapping {
  scale: number
  offsetX: number
  offsetY: number
}

/**
 * Maps the base canvas (the space sources are positioned in) onto the output
 * frame. Proportions are kept: when the two differ in shape the canvas is
 * centred with bars, rather than stretched.
 */
export function outputMapping(
  base: { width: number; height: number },
  out: { width: number; height: number },
): OutputMapping {
  const scale = Math.min(out.width / base.width, out.height / base.height)
  return {
    scale,
    offsetX: (out.width - base.width * scale) / 2,
    offsetY: (out.height - base.height * scale) / 2,
  }
}

export interface LayerPlan {
  /** Centre of the source's box, in base-canvas units. */
  cx: number
  cy: number
  /** Radians. */
  rotation: number
  scaleX: number
  scaleY: number
  /** The picture's rectangle, relative to the centre. */
  dx: number
  dy: number
  dw: number
  dh: number
}

export function layerPlan(t: SnapshotTransform, picture: { width: number; height: number }): LayerPlan {
  const fit = fitContain(picture.width, picture.height, t.width, t.height)

  return {
    cx: t.x + t.width / 2,
    cy: t.y + t.height / 2,
    rotation: (t.rotation * Math.PI) / 180,
    scaleX: t.scaleX,
    scaleY: t.scaleY,
    dx: -t.width / 2 + fit.x,
    dy: -t.height / 2 + fit.y,
    dw: fit.w,
    dh: fit.h,
  }
}
