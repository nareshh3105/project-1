/** What to tell the user when an output cannot keep up with its frame rate. */

const NAMES: Record<string, string> = {
  recording: 'recording',
  streaming: 'stream',
  replay: 'replay buffer',
  virtualCamera: 'virtual camera',
}

export function struggleMessage(kind: string, dropRatio: number): string {
  const percent = Math.max(1, Math.round(dropRatio * 100))
  return (
    `Your computer is not keeping up with the ${NAMES[kind] ?? 'output'}: about ${percent}% of frames are being dropped. ` +
    'Try the Performance preset in Settings, Output, or lower the frame rate or output size in Settings, Video.'
  )
}
