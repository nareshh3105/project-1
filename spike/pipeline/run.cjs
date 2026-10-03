'use strict'
/**
 * Runs the spike scenarios one after another and prints a comparison.
 *
 *   node spike/pipeline/run.cjs [--duration=30] [--only=1,2,3] [--list]
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

const duration = Number(arg('duration', '30'))
const engine = arg('engine', 'webcodecs')
const only = arg('only', '')
  .split(',')
  .filter(Boolean)
  .map(Number)

// Each scenario changes one thing from the baseline, so a difference in the
// result can be put down to that thing.
const scenarios = [
  { name: 'baseline: foreground', args: ['--scenario=fg'] },
  { name: 'minimized, hardened', args: ['--scenario=min'] },
  { name: 'minimized, defaults', args: ['--scenario=min', '--throttle=on', '--hardening=off'] },
  { name: 'minimized, rAF driver', args: ['--scenario=min', '--driver=raf'] },
  { name: 'hidden, hardened', args: ['--scenario=hide'] },
  { name: 'real screen layer, fg', args: ['--scenario=fg', '--layers=screen'] },
  { name: 'real screen layer, min', args: ['--scenario=min', '--layers=screen'] },
  { name: '1080p60, foreground', args: ['--scenario=fg', '--fps=60', '--bitrate=9000000'] },
  { name: 'software H.264 encoder', args: ['--scenario=fg', '--hw=prefer-software'] },
]

if (process.argv.includes('--list')) {
  scenarios.forEach((s, i) => console.log(`${i + 1}. ${s.name}  ${s.args.join(' ')}`))
  process.exit(0)
}

const outDir = path.join(os.tmpdir(), 'cb-spike')
fs.mkdirSync(outDir, { recursive: true })

const results = []

scenarios.forEach((s, i) => {
  const id = i + 1
  if (only.length && !only.includes(id)) return

  const out = path.join(outDir, `scenario-${id}.mkv`)
  for (const f of [out, `${out}.summary.json`]) fs.rmSync(f, { force: true })

  const fpsArg = s.args.find((a) => a.startsWith('--fps='))
  const fps = fpsArg ? Number(fpsArg.split('=')[1]) : 30

  process.stdout.write(`[${id}] ${s.name} ... `)
  const started = Date.now()
  const r = spawnSync(
    electron,
    [path.join(__dirname, 'main.cjs'), ...s.args, `--engine=${engine}`, `--duration=${duration}`, `--out=${out}`],
    { timeout: (duration + 120) * 1000, encoding: 'utf8', windowsHide: false },
  )

  const summaryFile = `${out}.summary.json`
  if (!fs.existsSync(summaryFile)) {
    console.log('FAILED (no summary)', (r.stderr || '').trim().split('\n').slice(-3).join(' | '))
    results.push({ id, name: s.name, failed: true })
    return
  }
  const summary = JSON.parse(fs.readFileSync(summaryFile, 'utf8'))
  if (summary.fatal) {
    console.log('FAILED:', summary.fatal.split('\n')[0])
    results.push({ id, name: s.name, failed: true, reason: summary.fatal })
    return
  }

  const analysis = fs.existsSync(out) ? analyze(out, fps) : { frames: { frames: 0 }, sync: {} }
  console.log(`done in ${Math.round((Date.now() - started) / 1000)}s`)
  results.push({ id, name: s.name, summary, analysis, fps })
})

fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2))

// ── Table ──
const f = (v, d = 1) => (v === null || v === undefined || Number.isNaN(v) ? '-' : Number(v).toFixed(d))
console.log('\n' + '-'.repeat(118))
console.log(
  'scenario'.padEnd(26),
  'frames'.padStart(7), 'want'.padStart(6), 'fps'.padStart(6),
  'maxGap'.padStart(7), 'stalls'.padStart(6),
  'cpu:ren'.padStart(8), 'gpu'.padStart(6), 'main'.padStart(6), 'ffmpeg'.padStart(7),
  'sync ms'.padStart(8), 'drift/min'.padStart(10), 'Mbps'.padStart(6),
)
console.log('-'.repeat(118))
for (const r of results) {
  if (r.failed) { console.log(r.name.padEnd(26), 'FAILED'); continue }
  const fr = r.analysis.frames
  const sy = r.analysis.sync
  const want = Math.round(r.summary.renderer.seconds * r.fps)
  console.log(
    r.name.padEnd(26),
    String(fr.frames ?? 0).padStart(7),
    String(want).padStart(6),
    f(fr.effectiveFps).padStart(6),
    f(fr.maxGapMs, 0).padStart(7),
    String(fr.stalls ?? '-').padStart(6),
    f(r.summary.cpuPercent.renderer, 0).padStart(8),
    f(r.summary.cpuPercent.gpu, 0).padStart(6),
    f(r.summary.cpuPercent.browser, 0).padStart(6),
    f(r.summary.ffmpegCpuSeconds !== null ? (r.summary.ffmpegCpuSeconds / duration) * 100 : null, 0).padStart(7),
    f(sy.meanOffsetMs, 0).padStart(8),
    f(sy.driftMsPerMin, 1).padStart(10),
    f(r.summary.mbps).padStart(6),
  )
}
console.log('-'.repeat(118))
console.log('cpu columns are % of one core; ffmpeg is its CPU time over the run. sync = audio minus video, ms.')
console.log(`details: ${path.join(outDir, 'results.json')}`)
