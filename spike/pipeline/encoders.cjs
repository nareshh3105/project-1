'use strict'
/**
 * Isolates MediaRecorder: records the test scene straight to a file, with no
 * FFmpeg in the path, and reports where each recording lost frames.
 *
 *   node spike/pipeline/encoders.cjs [--duration=15]
 */
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const electron = require('electron')
const { analyze } = require('./analyze.cjs')

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : dflt
}
const duration = Number(arg('duration', '15'))

const cases = [
  { name: 'h264 1080p30 manual', args: ['--codec=h264'] },
  { name: 'h264 1080p30 auto', args: ['--codec=h264', '--capture=auto'] },
  { name: 'h264 720p30 manual', args: ['--codec=h264', '--width=1280', '--height=720', '--bitrate=3000000'] },
  { name: 'vp8 1080p30 manual', args: ['--codec=vp8'] },
  { name: 'vp9 1080p30 manual', args: ['--codec=vp9'] },
]

const dir = path.join(os.tmpdir(), 'cb-spike')
fs.mkdirSync(dir, { recursive: true })

const rows = []
cases.forEach((c, i) => {
  const out = path.join(dir, `enc-${i + 1}.webm`)
  fs.rmSync(out, { force: true })
  process.stdout.write(`${c.name} ... `)
  spawnSync(
    electron,
    [path.join(__dirname, 'main.cjs'), '--scenario=fg', '--sink=file', `--duration=${duration}`, `--out=${out}`, ...c.args],
    { timeout: (duration + 90) * 1000 },
  )
  if (!fs.existsSync(out)) { console.log('no output'); rows.push({ name: c.name, failed: true }); return }

  const a = analyze(out, 30)
  const summary = JSON.parse(fs.readFileSync(`${out}.summary.json`, 'utf8'))

  // Where did the biggest gap start? Recomputed from frame times.
  const { spawnSync: sp } = require('node:child_process')
  const ff = path.resolve(__dirname, '..', '..', 'resources', 'ffmpeg', 'ffmpeg.exe')
  const r = sp(ff, ['-hide_banner', '-i', out, '-map', '0:v:0', '-vf', 'showinfo', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 28 })
  const t = [...(r.stderr || '').matchAll(/pts_time:\s*(-?[\d.]+)/g)].map((m) => Number(m[1]))
  let at = null
  let worst = 0
  for (let k = 1; k < t.length; k++) if (t[k] - t[k - 1] > worst) { worst = t[k] - t[k - 1]; at = t[k - 1] }

  console.log('done')
  rows.push({
    name: c.name,
    drawn: summary.renderer.drawn,
    frames: a.frames.frames,
    maxGapMs: a.frames.maxGapMs,
    gapStartsAt: at,
    stalls: a.frames.stalls,
    syncMs: a.sync.meanOffsetMs,
    mbps: summary.mbps,
  })
})

const f = (v, d = 0) => (v === null || v === undefined || Number.isNaN(v) ? '-' : Number(v).toFixed(d))
console.log('\n' + 'case'.padEnd(24), 'drawn'.padStart(6), 'in file'.padStart(8), 'maxGap ms'.padStart(10), 'starts at'.padStart(10), 'stalls'.padStart(7), 'sync ms'.padStart(8), 'Mbps'.padStart(6))
for (const r of rows) {
  if (r.failed) { console.log(r.name.padEnd(24), 'FAILED'); continue }
  console.log(r.name.padEnd(24), String(r.drawn).padStart(6), String(r.frames).padStart(8), f(r.maxGapMs).padStart(10), (f(r.gapStartsAt, 2) + 's').padStart(10), String(r.stalls).padStart(7), f(r.syncMs).padStart(8), f(r.mbps, 1).padStart(6))
}
