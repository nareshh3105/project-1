/**
 * The picture the virtual camera carries: NV12, 1280x720 at 30 fps. It matches
 * native/vcam/src/frames.h, which is what the camera expects to read.
 */
export const VCAM_WIDTH = 1280
export const VCAM_HEIGHT = 720
export const VCAM_FPS = 30
export const VCAM_FRAME_BYTES = (VCAM_WIDTH * VCAM_HEIGHT * 3) / 2

/** The port the camera connects to. The same as VCAM_PORT in native/vcam/src/frames.h. */
export const VCAM_PORT = 12347

/** The name apps show for the camera. */
export const VCAM_NAME = 'CodeBuilders Virtual Camera'

/**
 * Cuts a stream of raw pictures, as FFmpeg writes them, into whole frames.
 * Chunks arrive in whatever sizes the pipe gives; a frame is handed on only
 * once all of it is here, so a picture is never sent in two halves.
 */
export class FrameSplitter {
  private pending: Buffer[] = []
  private held = 0

  constructor(
    private readonly onFrame: (frame: Buffer) => void,
    private readonly frameBytes = VCAM_FRAME_BYTES,
  ) {}

  push(chunk: Buffer): void {
    this.pending.push(chunk)
    this.held += chunk.length

    while (this.held >= this.frameBytes) {
      const all = this.pending.length === 1 ? this.pending[0] : Buffer.concat(this.pending)
      this.onFrame(all.subarray(0, this.frameBytes))
      const rest = all.subarray(this.frameBytes)
      this.pending = rest.length ? [rest] : []
      this.held = rest.length
    }
  }

  /** Bytes of a frame that is not yet complete. */
  get partial(): number {
    return this.held
  }
}
