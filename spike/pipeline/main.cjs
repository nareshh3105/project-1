'use strict'
/**
 * Spike: can the renderer compose a scene and feed an encoder, the way OBS's
 * output does?
 *
 *   renderer canvas + WebAudio mix -> MediaRecorder -> IPC -> ffmpeg stdin -> file
 *
 * This is an experiment, not app code. It answers three questions before the
 * real pipeline is built on top of it:
 *   1. Does composition keep running when the window is minimized or hidden?
 *   2. What does it cost in CPU, and does it drop frames?
 *   3. Do audio and video stay in step?
 *
 * Run through run.cjs, or directly:
 *   electron spike/pipeline/main.cjs --scenario=min --duration=30
 */
const { app, BrowserWindow, ipcMain, session, desktopCapturer } = require('electron')
const { spawn, execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : dflt
}

const root = path.resolve(__dirname, '..', '..')
const opts = {
  scenario: arg('scenario', 'fg'),      // fg | min | hide
  duration: Number(arg('duration', '30')),
  throttle: arg('throttle', 'off'),     // webPreferences.backgroundThrottling
  hardening: arg('hardening', 'on'),    // chromium switches against backgrounding/occlusion
  driver: arg('driver', 'timer'),       // timer | raf
  layers: arg('layers', 'synthetic'),   // synthetic | screen (real display capture)
  codec: arg('codec', 'h264'),          // h264 | vp8 | vp9
  fps: Number(arg('fps', '30')),
  width: Number(arg('width', '1920')),
  height: Number(arg('height', '1080')),
  bitrate: Number(arg('bitrate', '6000000')),
  out: arg('out', path.join(os.tmpdir(), 'cb-spike', 'run.mkv')),
  ffmpeg: arg('ffmpeg', path.join(root, 'resources', 'ffmpeg', 'ffmpeg.exe')),
  // ffmpeg: pipe through the encoder as the app would. file: write the
  // recorder's raw output, to tell a recorder fault from a pipe fault.
  sink: arg('sink', 'ffmpeg'),
  capture: arg('capture', 'manual'),    // manual | auto (canvas.captureStream mode)
  delay: Number(arg('delay', '0')),     // seconds the page draws before recording starts
  audio: arg('audio', 'on'),            // on | off (video-only recording)
  probe: arg('probe', 'off'),           // on: count frames on a second consumer of the track
  engine: arg('engine', 'mediarecorder'), // mediarecorder | webcodecs
  hw: arg('hw', 'prefer-hardware'),     // webcodecs: prefer-hardware | prefer-software
  queue: Number(arg('queue', '6')),     // webcodecs: frames allowed to wait before dropping
  features: arg('features', 'CalculateNativeWinOcclusion'), // value of --disable-features
  audiosink: arg('audiosink', 'stream'), // stream: MediaStreamDestination only | device: also a silent path to the real output
  gc: arg('gc', 'off'),                 // on: force garbage collection every 10 s, to provoke lifetime bugs
}

if (opts.gc === 'on') app.commandLine.appendSwitch('js-flags', '--expose-gc')

fs.mkdirSync(path.dirname(opts.out), { recursive: true })
const summaryFile = `${opts.out}.summary.json`
const ffmpegLog = `${opts.out}.ffmpeg.log`

// Never touch the real app's data.
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'cb-spike-ud-')))

if (opts.hardening === 'on') {
  // The switches that keep a page rendering when its window is covered,
  // minimized or in the background.
  app.commandLine.appendSwitch('disable-renderer-backgrounding')
  app.commandLine.appendSwitch('disable-background-timer-throttling')
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
  app.commandLine.appendSwitch('disable-features', opts.features)
}

let win = null
let ff = null
let ffCpuStart = null
let bytesIn = 0
let chunksIn = 0
let backpressure = 0
const cpuSamples = []
const rendererStats = []
let sampler = null
const t0 = Date.now()

const cpuSeconds = (pid) => {
  try {
    const out = execFileSync(
      'powershell',
      ['-NoProfile', '-Command', `(Get-Process -Id ${pid}).TotalProcessorTime.TotalSeconds`],
      { encoding: 'utf8', windowsHide: true },
    )
    return Number(out.trim())
  } catch {
    return null
  }
}

let rawFile = null

function startFfmpeg() {
  if (opts.sink === 'file') {
    rawFile = fs.createWriteStream(opts.out)
    return
  }

  const videoArgs =
    opts.codec === 'h264'
      ? ['-c:v', 'copy']
      : ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p']

  const args = [
    '-hide_banner', '-loglevel', 'info',
    '-i', 'pipe:0',
    ...videoArgs,
    '-c:a', 'aac', '-b:a', '160k',
    '-y', opts.out,
  ]

  ff = spawn(opts.ffmpeg, args, { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true })
  const log = fs.createWriteStream(ffmpegLog)
  ff.stderr.pipe(log)
  ff.stdin.on('error', () => { /* a late write after exit is expected at shutdown */ })
  ffCpuStart = cpuSeconds(ff.pid)
}

function sampleCpu() {
  const metrics = app.getAppMetrics()
  const sum = (types) =>
    metrics.filter((m) => types.includes(m.type)).reduce((a, m) => a + m.cpu.percentCPUUsage, 0)
  cpuSamples.push({
    t: (Date.now() - t0) / 1000,
    browser: sum(['Browser']),
    renderer: sum(['Tab']),
    gpu: sum(['GPU']),
    // Working set in MB, to show whether memory climbs over a long recording.
    memRendererMB: metrics.filter((m) => m.type === 'Tab').reduce((a, m) => a + m.memory.workingSetSize, 0) / 1024,
    memGpuMB: metrics.filter((m) => m.type === 'GPU').reduce((a, m) => a + m.memory.workingSetSize, 0) / 1024,
    minimized: win ? win.isMinimized() : null,
    visible: win ? win.isVisible() : null,
  })
}

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

async function finish(rendererFinal) {
  clearInterval(sampler)

  const ffCpuEnd = ff && ff.exitCode === null ? cpuSeconds(ff.pid) : null
  if (rawFile) await new Promise((resolve) => rawFile.end(resolve))
  if (ff) {
    ff.stdin.end()
    await new Promise((resolve) => {
      const kill = setTimeout(() => { ff.kill(); resolve() }, 15000)
      ff.on('exit', () => { clearTimeout(kill); resolve() })
    })
  }

  // Skip the first samples: the page is still starting up.
  const steady = cpuSamples.filter((s) => s.t > 6)
  const summary = {
    opts,
    cpuModel: os.cpus()[0].model,
    cores: os.cpus().length,
    bytesIn,
    chunksIn,
    backpressure,
    mbps: (bytesIn * 8) / 1e6 / opts.duration,
    cpuPercent: {
      browser: avg(steady.map((s) => s.browser)),
      renderer: avg(steady.map((s) => s.renderer)),
      gpu: avg(steady.map((s) => s.gpu)),
    },
    ffmpegCpuSeconds:
      ffCpuStart !== null && ffCpuEnd !== null ? ffCpuEnd - ffCpuStart : null,
    memory: {
      rendererStartMB: (steady[0] || {}).memRendererMB,
      rendererEndMB: (steady[steady.length - 1] || {}).memRendererMB,
      gpuStartMB: (steady[0] || {}).memGpuMB,
      gpuEndMB: (steady[steady.length - 1] || {}).memGpuMB,
    },
    cpuSeries: cpuSamples,
    renderer: rendererFinal,
    rendererSeries: rendererStats,
  }
  fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2))
  app.quit()
}

ipcMain.on('chunk', (_e, buffer) => {
  if (rawFile) {
    chunksIn++
    bytesIn += buffer.byteLength
    rawFile.write(Buffer.from(buffer))
    return
  }
  if (!ff) return
  chunksIn++
  bytesIn += buffer.byteLength
  const ok = ff.stdin.write(Buffer.from(buffer))
  if (!ok) {
    backpressure++
    ff.stdin.once('drain', () => {})
  }
})

ipcMain.on('stats', (_e, s) => rendererStats.push({ ...s, wall: (Date.now() - t0) / 1000 }))

ipcMain.on('started', () => {
  // Drive the window state from here: renderer timers are the thing being
  // tested, so they cannot be trusted to do it.
  if (opts.scenario === 'min') setTimeout(() => win.minimize(), 5000)
  if (opts.scenario === 'hide') setTimeout(() => win.hide(), 5000)
  setTimeout(() => win.webContents.send('stop'), opts.duration * 1000)
})

ipcMain.on('done', (_e, final) => { void finish(final) })
ipcMain.on('fatal', (_e, message) => {
  fs.writeFileSync(summaryFile, JSON.stringify({ opts, fatal: message }, null, 2))
  clearInterval(sampler)
  if (ff) ff.kill()
  app.quit()
})

app.whenReady().then(async () => {
  if (opts.layers === 'screen') {
    // Pick the primary screen without a dialog, the way the real app would.
    session.defaultSession.setDisplayMediaRequestHandler((_req, callback) => {
      desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
        callback({ video: sources[0] })
      })
    })
  }

  // 'offscreen' keeps the window visible but parked outside every display, so
  // it is never minimized or hidden.
  const parked = opts.scenario === 'offscreen' ? { x: -32000, y: -32000 } : {}
  win = new BrowserWindow({
    ...parked,
    width: 1280,
    height: 720,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      backgroundThrottling: opts.throttle === 'on',
      autoplayPolicy: 'no-user-gesture-required',
    },
  })

  startFfmpeg()
  sampler = setInterval(sampleCpu, 2000)

  await win.loadFile(path.join(__dirname, 'index.html'))
  win.webContents.send('config', opts)
})

app.on('window-all-closed', () => { /* the run ends through finish() */ })
