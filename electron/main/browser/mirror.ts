import type { PageUpdate } from '../../../shared/host'

/**
 * The whole picture of a page, kept up to date from the changed regions it paints.
 *
 * A page that is not changing paints nothing, and one that is changing usually
 * changes a small part of itself, so only the changed part is worth sending
 * anywhere. This keeps the full picture so that a window that starts watching
 * later can be given all of it at once.
 */

const BYTES = 4

export class PageMirror {
  private width = 0
  private height = 0
  private pixels = new Uint8Array(0)
  private hasPicture = false

  /**
   * Takes a changed region. Returns false if it was not usable: a region that
   * does not fit its own size, lies outside the page, or arrives for a page of a
   * new size before the whole of that page has been painted.
   */
  apply(update: PageUpdate): boolean {
    const { width, height, x, y, w, h, bgra } = update
    if (!isWhole(width) || !isWhole(height) || !isWhole(x) || !isWhole(y) || !isWhole(w) || !isWhole(h)) return false
    if (width === 0 || height === 0 || w === 0 || h === 0) return false
    if (bgra.length !== w * h * BYTES) return false
    if (x < 0 || y < 0 || x + w > width || y + h > height) return false

    if (width !== this.width || height !== this.height) {
      // The page changed size: what is held no longer applies, and only the whole page can start it again.
      const whole = x === 0 && y === 0 && w === width && h === height
      if (!whole) return false
      this.width = width
      this.height = height
      this.pixels = new Uint8Array(width * height * BYTES)
    }

    for (let row = 0; row < h; row++) {
      const from = row * w * BYTES
      this.pixels.set(bgra.subarray(from, from + w * BYTES), ((y + row) * this.width + x) * BYTES)
    }
    this.hasPicture = true
    return true
  }

  /** All of the picture as one update, or null if nothing has been painted yet. */
  whole(): PageUpdate | null {
    if (!this.hasPicture) return null
    return { width: this.width, height: this.height, x: 0, y: 0, w: this.width, h: this.height, bgra: this.pixels }
  }
}

const isWhole = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0
