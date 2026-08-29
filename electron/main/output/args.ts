/**
 * ffmpeg argument construction.
 *
 * Kept apart from the command handlers so the mapping logic can be tested
 * without spawning a process — a wrong stream index yields a recording with
 * silent or duplicated tracks, which is easy to ship and expensive to notice.
 */

/** Encoder settings shared by the recording and replay paths. */
export const X264_ARCHIVE = [
  '-c:v', 'libx264',
  '-preset', 'ultrafast',
  '-crf', '23',
  '-pix_fmt', 'yuv420p',
]

export interface AudioArgs {
  /** Input declarations, one pair per device, appended after the video input. */
  inputs: string[]
  /** Mapping and encoder arguments for the output file. */
  output: string[]
}

/**
 * Builds the audio half of a recording command.
 *
 * Each selected device becomes its own input and its own output track so the
 * result can be remixed afterwards. Stream indices are offset by one because
 * input 0 is always the screen capture.
 *
 * When any track requests noise suppression the whole set has to route through
 * filter_complex: a plain `-map` list cannot express a mixture of filtered and
 * unfiltered streams, so untouched tracks pass through `acopy`.
 */
export function audioArgs(tracks: string[], ns: boolean[]): AudioArgs {
  const inputs: string[] = []
  for (const device of tracks) {
    inputs.push('-f', 'dshow', '-i', `audio=${device}`)
  }

  const output: string[] = []
  if (tracks.length === 0) {
    output.push('-map', '0:v:0')
    return { inputs, output }
  }

  const encoders = tracks.flatMap((_, i) => [
    `-c:a:${i}`, 'aac', `-b:a:${i}`, '192k',
  ])

  if (ns.some(Boolean)) {
    const filters = tracks.map((_, i) =>
      ns[i]
        ? `[${i + 1}:a:0]afftdn=nf=-25[a${i}]`
        : `[${i + 1}:a:0]acopy[a${i}]`,
    )
    output.push('-filter_complex', filters.join(';'))
    output.push('-map', '0:v:0')
    tracks.forEach((_, i) => output.push('-map', `[a${i}]`))
    output.push(...encoders)
  } else {
    output.push(...encoders)
    output.push('-map', '0:v:0')
    tracks.forEach((_, i) => output.push('-map', `${i + 1}:a:0`))
  }

  return { inputs, output }
}
