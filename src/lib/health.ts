/** What to tell the user when an output cannot keep up with its frame rate. */

const NAMES: Record<string, string> = {
  recording: 'recording',
  streaming: 'stream',
  replay: 'replay buffer',
  virtualCamera: 'virtual camera',
}

export function struggleMessage(kind: string, dropRatio: number): string {
  const percent = Math.max(1, Math.round(dropRatio * 100))
  if (kind === 'streaming') {
    // A stream can fall behind because the computer is slow or because the internet connection is.
    return (
      `The stream is not keeping up: about ${percent}% of frames are being dropped. ` +
      'This is usually your internet upload speed, or the computer. Lower the Video Bitrate in Settings, Output ' +
      '(try 4 Mbps for 720p, 6 Mbps for 1080p), or choose the Balanced or Performance preset.'
    )
  }
  return (
    `Your computer is not keeping up with the ${NAMES[kind] ?? 'output'}: about ${percent}% of frames are being dropped. ` +
    'Try the Performance preset in Settings, Output, or lower the frame rate or output size in Settings, Video.'
  )
}
