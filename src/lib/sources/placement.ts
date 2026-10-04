/**
 * Where a picture goes on the canvas when it is first chosen.
 *
 * Shown at its own size if it fits, scaled down (never up) to fit inside the
 * canvas if it does not, and centred. Without this a picture would appear
 * stretched into whatever box the source happened to start with.
 */

export interface Size { width: number; height: number }
export interface Box extends Size { x: number; y: number }

export function fitWithin(picture: Size, canvas: Size): Box {
  const w = Number.isFinite(picture.width) && picture.width > 0 ? picture.width : canvas.width
  const h = Number.isFinite(picture.height) && picture.height > 0 ? picture.height : canvas.height

  const scale = Math.min(1, canvas.width / w, canvas.height / h)
  const width = Math.max(1, Math.round(w * scale))
  const height = Math.max(1, Math.round(h * scale))

  return {
    width,
    height,
    x: Math.round((canvas.width - width) / 2),
    y: Math.round((canvas.height - height) / 2),
  }
}
