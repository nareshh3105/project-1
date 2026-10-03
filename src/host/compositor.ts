import type { SnapshotTransform } from '../../shared/host'
import { layerPlan, outputMapping } from './geometry'

/**
 * Draws one frame of the scene.
 *
 * Takes only what it needs to draw (a context, sizes, and the layers that are
 * ready) so it can be tested against a recording fake, and so it never reaches
 * into the capture or snapshot code. Layers arrive bottom first.
 */

/** The part of CanvasRenderingContext2D this uses. */
export interface DrawContext {
  fillStyle: string | CanvasGradient | CanvasPattern
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void
  fillRect(x: number, y: number, w: number, h: number): void
  save(): void
  restore(): void
  beginPath(): void
  rect(x: number, y: number, w: number, h: number): void
  clip(): void
  translate(x: number, y: number): void
  rotate(angle: number): void
  scale(x: number, y: number): void
  drawImage(image: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void
}

/** A source with a picture ready to draw. */
export interface ReadyLayer {
  transform: SnapshotTransform
  image: CanvasImageSource
  /** The picture's own size, for fitting it inside the source's box. */
  width: number
  height: number
}

export function drawFrame(
  ctx: DrawContext,
  out: { width: number; height: number },
  base: { width: number; height: number },
  layers: readonly ReadyLayer[],
): void {
  // Start from black, whatever the previous frame left behind.
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, out.width, out.height)

  const m = outputMapping(base, out)

  ctx.save()
  ctx.setTransform(m.scale, 0, 0, m.scale, m.offsetX, m.offsetY)

  // Nothing may spill outside the base canvas, as in the preview.
  ctx.beginPath()
  ctx.rect(0, 0, base.width, base.height)
  ctx.clip()

  for (const layer of layers) {
    const p = layerPlan(layer.transform, layer)

    ctx.save()
    ctx.translate(p.cx, p.cy)
    ctx.rotate(p.rotation)
    ctx.scale(p.scaleX, p.scaleY)
    ctx.drawImage(layer.image, p.dx, p.dy, p.dw, p.dh)
    ctx.restore()
  }

  ctx.restore()
}
