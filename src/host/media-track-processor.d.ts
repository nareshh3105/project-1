/**
 * MediaStreamTrackProcessor (insertable streams for media): turns a track into a
 * stream of AudioData or VideoFrame. Shipped in Chromium; not yet in TypeScript's DOM types.
 */
declare class MediaStreamTrackProcessor<T = AudioData | VideoFrame> {
  constructor(init: { track: MediaStreamTrack; maxBufferSize?: number })
  readonly readable: ReadableStream<T>
}
