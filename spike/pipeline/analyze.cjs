'use strict'
/**
 * Measures a recording made by the spike, using only the file.
 *
 *   node analyze.cjs <file> <fps>
 *
 * Frames: how many arrived, and how long the longest stall was.
 * Sync:   when the white flashes appear versus when the beeps do. The scene
 *         produces both at the same instants, so any offset is introduced by
 *         the recording path, and a growing offset is drift.
 */
const { spawnSync } = require('node:child_process')
const path = require('node:path')

const FFMPEG = path.resolve(__dirname, '..', '..', 'resources', 'ffmpeg', 'ffmpeg.exe')

function run(args) {
  const r = spawnSync(FFMPEG, ['-hide_banner', ...args], {
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    windowsHide: true,
  })
  return { out: r.stdout || '', err: r.stderr || '', status: r.status }
}

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : null)
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

function frameStats(file, fps) {
  const { err } = run(['-i', file, '-map', '0:v:0', '-vf', 'showinfo', '-f', 'null', '-'])
  const times = [...err.matchAll(/pts_time:\s*(-?[\d.]+)/g)].map((m) => Number(m[1]))
  if (times.length < 2) return { frames: times.length }

  const gaps = []
  for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1])
  const sorted = [...gaps].sort((a, b) => a - b)
  const span = times[times.length - 1] - times[0]
  const frameMs = 1000 / fps

  return {
    frames: times.length,
    spanSeconds: span,
    effectiveFps: (times.length - 1) / span,
    medianGapMs: pct(sorted, 0.5) * 1000,
    p99GapMs: pct(sorted, 0.99) * 1000,
    maxGapMs: sorted[sorted.length - 1] * 1000,
    // A stall is a gap of more than two frame intervals.
    stalls: gaps.filter((g) => g * 1000 > 2 * frameMs).length,
    firstFrameAt: times[0],
  }
}

/** Times at which the picture goes from not-white to white. */
function flashTimes(file) {
  const { out } = run([
    '-i', file, '-map', '0:v:0',
    '-vf', 'scale=32:18,signalstats,metadata=mode=print:key=lavfi.signalstats.YAVG:file=-',
    '-f', 'null', '-',
  ])
  const samples = [...out.matchAll(/pts_time:\s*([\d.]+)\s*\r?\n\s*lavfi\.signalstats\.YAVG=([\d.]+)/g)].map(
    (m) => ({ t: Number(m[1]), y: Number(m[2]) }),
  )
  // "White" is relative to what this recording shows: a recording of a real
  // screen may never reach pure white, and one with other windows showing has
  // a baseline well above black.
  const ys = samples.map((s) => s.y)
  const lo = Math.min(...ys)
  const hi = Math.max(...ys)
  const threshold = hi - lo > 60 ? lo + 0.6 * (hi - lo) : 230
  const onsets = []
  let was = false
  for (const s of samples) {
    const white = s.y >= threshold
    if (white && !was) onsets.push(s.t)
    was = white
  }
  return onsets
}

/** Times at which a beep begins: the end of each stretch of silence. */
function beepTimes(file) {
  const { err } = run(['-i', file, '-map', '0:a:0', '-af', 'silencedetect=noise=-50dB:d=0.3', '-f', 'null', '-'])
  return [...err.matchAll(/silence_end:\s*([\d.]+)/g)].map((m) => Number(m[1]))
}

function sync(file) {
  const flashes = flashTimes(file)
  const beeps = beepTimes(file)

  // Pair each flash with the nearest beep, within half a second.
  const offsets = []
  for (const f of flashes) {
    let best = null
    for (const b of beeps) if (best === null || Math.abs(b - f) < Math.abs(best - f)) best = b
    if (best !== null && Math.abs(best - f) < 0.5) offsets.push({ at: f, ms: (best - f) * 1000 })
  }
  if (!offsets.length) return { flashes: flashes.length, beeps: beeps.length, matched: 0 }

  const ms = offsets.map((o) => o.ms)
  const n = ms.length
  const head = mean(ms.slice(0, Math.min(5, n)))
  const tail = mean(ms.slice(Math.max(0, n - 5)))

  // Least-squares slope of offset against time, in ms per minute.
  const ts = offsets.map((o) => o.at)
  const tBar = mean(ts)
  const mBar = mean(ms)
  const num = ts.reduce((a, t, i) => a + (t - tBar) * (ms[i] - mBar), 0)
  const den = ts.reduce((a, t) => a + (t - tBar) ** 2, 0)

  return {
    flashes: flashes.length,
    beeps: beeps.length,
    matched: n,
    meanOffsetMs: mean(ms),
    minOffsetMs: Math.min(...ms),
    maxOffsetMs: Math.max(...ms),
    headMs: head,
    tailMs: tail,
    driftMsPerMin: den ? (num / den) * 60 : 0,
  }
}

function analyze(file, fps) {
  return { frames: frameStats(file, fps), sync: sync(file) }
}

module.exports = { analyze }

if (require.main === module) {
  const [, , file, fps] = process.argv
  console.log(JSON.stringify(analyze(file, Number(fps || 30)), null, 2))
}
