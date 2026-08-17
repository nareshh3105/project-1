import { describe, it, expect } from 'vitest'
import { audioArgs } from '../../electron/main/output/args'

/**
 * The recording command builds its ffmpeg invocation dynamically to support
 * any number of audio tracks, with an entirely different mapping strategy once
 * noise suppression is involved. Getting a stream index wrong produces a
 * recording with silent or duplicated tracks, which is expensive to notice.
 */

const idx = (args: string[], value: string) => args.indexOf(value)

describe('audioArgs — no tracks', () => {
  it('adds no inputs', () => {
    expect(audioArgs([], []).inputs).toEqual([])
  })

  it('maps video only', () => {
    expect(audioArgs([], []).output).toEqual(['-map', '0:v:0'])
  })

  it('adds no audio encoder', () => {
    expect(audioArgs([], []).output.join(' ')).not.toContain('-c:a')
  })
})

describe('audioArgs — tracks without noise suppression', () => {
  const tracks = ['Microphone', 'Desktop Audio']

  it('adds one dshow input per device', () => {
    expect(audioArgs(tracks, [false, false]).inputs).toEqual([
      '-f', 'dshow', '-i', 'audio=Microphone',
      '-f', 'dshow', '-i', 'audio=Desktop Audio',
    ])
  })

  it('maps each device to its own stream, offset past the video input', () => {
    const { output } = audioArgs(tracks, [false, false])
    // Input 0 is the screen, so audio devices start at 1.
    expect(output).toContain('1:a:0')
    expect(output).toContain('2:a:0')
  })

  it('encodes one aac track per device', () => {
    const { output } = audioArgs(tracks, [false, false])
    expect(output).toEqual(expect.arrayContaining(['-c:a:0', '-c:a:1']))
    expect(output.filter((a) => a === 'aac')).toHaveLength(2)
  })

  it('does not build a filter graph when none is needed', () => {
    expect(audioArgs(tracks, [false, false]).output).not.toContain('-filter_complex')
  })

  it('treats an absent suppression array as all-off', () => {
    expect(audioArgs(tracks, []).output).not.toContain('-filter_complex')
  })
})

describe('audioArgs — noise suppression', () => {
  const tracks = ['Microphone', 'Desktop Audio']

  it('switches to a filter graph when any track requests it', () => {
    expect(audioArgs(tracks, [true, false]).output).toContain('-filter_complex')
  })

  it('applies the denoiser only to the requested track', () => {
    const { output } = audioArgs(tracks, [true, false])
    const graph = output[idx(output, '-filter_complex') + 1]

    expect(graph).toContain('[1:a:0]afftdn=nf=-25[a0]')
    // The untouched track still has to pass through the graph to be mapped.
    expect(graph).toContain('[2:a:0]acopy[a1]')
  })

  it('maps the filter outputs rather than the raw inputs', () => {
    const { output } = audioArgs(tracks, [true, false])
    expect(output).toContain('[a0]')
    expect(output).toContain('[a1]')
    expect(output).not.toContain('1:a:0')
  })

  it('still maps the video stream first', () => {
    const { output } = audioArgs(tracks, [true, true])
    expect(idx(output, '0:v:0')).toBeGreaterThan(-1)
    expect(idx(output, '0:v:0')).toBeLessThan(idx(output, '[a0]'))
  })

  it('denoises every track when all request it', () => {
    const graph = audioArgs(tracks, [true, true]).output[
      idx(audioArgs(tracks, [true, true]).output, '-filter_complex') + 1
    ]
    expect(graph.match(/afftdn/g)).toHaveLength(2)
    expect(graph).not.toContain('acopy')
  })

  it('keeps an encoder per track in the filtered path', () => {
    const { output } = audioArgs(tracks, [true, false])
    expect(output).toEqual(expect.arrayContaining(['-c:a:0', '-c:a:1']))
  })

  it('handles a single suppressed track', () => {
    const { output } = audioArgs(['Mic'], [true])
    const graph = output[idx(output, '-filter_complex') + 1]
    expect(graph).toBe('[1:a:0]afftdn=nf=-25[a0]')
  })

  it('separates multiple filter chains with semicolons', () => {
    const { output } = audioArgs(tracks, [true, false])
    const graph = output[idx(output, '-filter_complex') + 1]
    expect(graph.split(';')).toHaveLength(2)
  })
})

describe('audioArgs — device names', () => {
  it('passes names containing spaces through unquoted for argv', () => {
    // spawn passes argv directly, so shell quoting would end up in the name.
    expect(audioArgs(['Microphone Array (Realtek)'], []).inputs).toContain(
      'audio=Microphone Array (Realtek)',
    )
  })

  it('scales to more tracks than the interface exposes', () => {
    const many = ['A', 'B', 'C', 'D', 'E']
    const { inputs, output } = audioArgs(many, many.map(() => false))
    expect(inputs.filter((a) => a === 'dshow')).toHaveLength(5)
    expect(output).toContain('5:a:0')
  })
})
