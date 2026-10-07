'use strict'
/**
 * End-to-end check of the real app: launches the built application with a fresh
 * profile, drives it over the DevTools protocol, records the screen and the
 * system audio for a while with the interface window minimized, and measures
 * the file.
 *
 *   node scripts/e2e/record.cjs [seconds] [--fps=30] [--res=1280x720] [--no-minimize]
 *                               [--kind=recording|streaming|replay|vcam] [--keep]
 *
 * Run `npm run build` (electron-vite build) first.
 */
const { spawn, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const root = path.resolve(__dirname, '..', '..')
const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.split('=')[1] : fallback
}
const seconds = Number(args.find((a) => /^\d+$/.test(a)) || 30)
const fps = Number(flag('fps', 30))
const [width, height] = flag('res', '1280x720').split('x').map(Number)
const minimize = !args.includes('--no-minimize')
const withSync = args.includes('--sync')
const arrange = args.includes('--arrange')
const overlay = args.includes('--overlay')
const filtersTest = args.includes('--filters')
const transitionType = flag('transition', '')
const weakCores = Number(flag('weak', 0))
const mediaFile = flag('media', '')
const webPage = args.includes('--browser')
const trackCount = Number(flag('tracks', 1))
const PORT = 9333

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-e2e-'))
const outFile = path.join(scratch, 'e2e.mkv')
const log = (...m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s]`, ...m)
const t0 = Date.now()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── DevTools protocol over a WebSocket ──

async function targets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
  return res.json()
}

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url)
    this.id = 0
    this.pending = new Map()
    this.ready = new Promise((resolve, reject) => {
      this.ws.onopen = resolve
      this.ws.onerror = reject
    })
    this.ws.onmessage = (e) => {
      const m = JSON.parse(e.data)
      const p = this.pending.get(m.id)
      if (!p) return
      this.pending.delete(m.id)
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result)
    }
  }
  send(method, params = {}) {
    const id = ++this.id
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
    return r.result.value
  }
  close() { try { this.ws.close() } catch { /* closed */ } }
}

/** Working set of every process started with this run's profile, in MB. */
function memoryMb(dir) {
  // Matched by the run's unique folder name, which avoids path escaping entirely.
  const tag = path.basename(dir)
  const ps = `(Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.CommandLine -like '*${tag}*' } | Measure-Object WorkingSetSize -Sum).Sum`
  const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' })
  return Math.round(Number(r.stdout.trim() || 0) / 1048576)
}

/** Confines every process of this run to the first `cores` logical processors, at low priority: a slow computer, simulated. */
function restrictCpu(dir, cores) {
  const tag = path.basename(dir)
  const mask = (1 << cores) - 1
  const ps = `Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.CommandLine -like '*${tag}*' } | ForEach-Object { try { $p = Get-Process -Id $_.ProcessId; $p.ProcessorAffinity = ${mask}; $p.PriorityClass = 'BelowNormal' } catch {} }`
  spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' })
}

/** CPU seconds used so far by each of this run's processes, by role. */
function cpuSeconds(dir) {
  const tag = path.basename(dir)
  const ps = `Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.CommandLine -like '*${tag}*' } | ForEach-Object { $t = 'main'; if ($_.CommandLine -match '--type=([a-z-]+)') { $t = $Matches[1] }; if ($_.CommandLine -match 'host.html') { $t = 'host' }; "$t,$($_.ProcessId),$(($_.UserModeTime + $_.KernelModeTime) / 10000000)" }`
  const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' })
  const out = {}
  for (const line of r.stdout.trim().split(String.fromCharCode(10))) {
    const [type, pid, secs] = line.split(',')
    if (pid) out[`${type}:${pid}`] = Number(secs)
  }
  return out
}

/**
 * Brightest the corners and the middle of the picture ever get. With the source
 * shrunk to the middle and the screen flashing white, the middle must reach
 * white while the corners stay black.
 */
function arrangeCheck(file) {
  const ffmpegExe = path.join(root, 'resources', 'ffmpeg', 'ffmpeg.exe')
  const peak = (crop) => {
    const r = spawnSync(ffmpegExe, ['-hide_banner', '-i', file, '-map', '0:v:0', '-vf',
      `crop=${crop},scale=16:9,signalstats,metadata=mode=print:key=lavfi.signalstats.YAVG:file=-`, '-f', 'null', '-'],
    { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 })
    const ys = [...r.stdout.matchAll(/YAVG=([\d.]+)/g)].map((m) => Number(m[1]))
    return ys.length ? Math.max(...ys) : null
  }
  // Fractions of the frame: a corner patch, and a patch in the middle.
  return { cornerPeak: peak('iw*0.15:ih*0.15:0:0'), centrePeak: peak('iw*0.3:ih*0.3:iw*0.35:ih*0.35') }
}

/** Average and peak color in the two overlay boxes, in the recording. */
function overlayCheck(file, outW, outH) {
  const ffmpegExe = path.join(root, 'resources', 'ffmpeg', 'ffmpeg.exe')
  const k = outW / 1920
  const region = (x, y, w, h) => {
    const crop = [w, h, x, y].map((v) => Math.round(v * k)).join(':')
    const r = spawnSync(ffmpegExe, ['-hide_banner', '-ss', '3', '-i', file, '-t', '8', '-map', '0:v:0', '-vf',
      `crop=${crop},signalstats,metadata=mode=print:file=-`, '-f', 'null', '-'],
    { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 })
    const get = (key) => {
      const vs = [...r.stdout.matchAll(new RegExp('lavfi.signalstats.' + key + '=([0-9.]+)', 'g'))].map((m) => Number(m[1]))
      return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null
    }
    return { y: get('YAVG'), u: get('UAVG'), v: get('VAVG'), yMax: get('YMAX') }
  }
  // Green is low U and low V; red is low U and high V. White text raises the peak brightness.
  return { green: region(120, 120, 480, 240), words: region(1200, 120, 600, 240) }
}

/**
 * The three filtered boxes, as the recording shows them.
 *  keyed:   green with a chroma key should show what is behind it, not green.
 *  grey:    red with no saturation should have no colour at all (U and V at 128).
 *  cropped: blue with its left half cropped is half as wide, so the left of its box is not blue.
 */
function filtersCheck(file, outW) {
  const ffmpegExe = path.join(root, 'resources', 'ffmpeg', 'ffmpeg.exe')
  const k = outW / 1920
  const region = (x, y, w, h) => {
    const crop = [w, h, x, y].map((v) => Math.round(v * k)).join(':')
    const r = spawnSync(ffmpegExe, ['-hide_banner', '-ss', '3', '-i', file, '-t', '8', '-map', '0:v:0', '-vf',
      `crop=${crop},signalstats,metadata=mode=print:file=-`, '-f', 'null', '-'],
    { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 })
    const get = (key) => {
      const vs = [...r.stdout.matchAll(new RegExp('lavfi.signalstats.' + key + '=([0-9.]+)', 'g'))].map((m) => Number(m[1]))
      return vs.length ? Number((vs.reduce((a, b) => a + b, 0) / vs.length).toFixed(1)) : null
    }
    return { y: get('YAVG'), u: get('UAVG'), v: get('VAVG') }
  }
  return {
    keyed: region(150, 150, 420, 180),
    grey: region(730, 150, 420, 180),
    croppedLeftEdge: region(1250, 150, 60, 180),
    croppedCentre: region(1480, 150, 80, 180),
  }
}

/**
 * Left-half and right-half blue (U) every quarter second around the transition.
 * Red has U about 90 and blue about 240.
 *  fade:  both halves rise together through the middle values.
 *  slide: halfway through, the left half is still red and the right half already blue.
 *  wipe:  halfway through, the left half is blue and the right half still red.
 */
function transitionCheck(file, outW, outH, at) {
  const ffmpegExe = path.join(root, 'resources', 'ffmpeg', 'ffmpeg.exe')
  const half = (x) => {
    const r = spawnSync(ffmpegExe, ['-hide_banner', '-ss', String(Math.max(0, at - 1)), '-i', file, '-t', '4.5', '-map', '0:v:0', '-vf',
      `fps=4,crop=${Math.floor(outW / 2)}:${outH}:${x}:0,signalstats,metadata=mode=print:key=lavfi.signalstats.UAVG:file=-`, '-f', 'null', '-'],
    { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 })
    return [...r.stdout.matchAll(/UAVG=([0-9.]+)/g)].map((m) => Math.round(Number(m[1])))
  }
  return { fromSecondsBefore: 1, leftU: half(0), rightU: half(Math.floor(outW / 2)) }
}

/**
 * A played video file: its picture must be moving (the brightness of a patch of
 * the picture changes from frame to frame) and its sound must be in the file
 * (the loudest sample is near the tone's level, not silence).
 */
function mediaCheck(file) {
  const ffmpegExe = path.join(root, 'resources', 'ffmpeg', 'ffmpeg.exe')
  const run = (args) => spawnSync(ffmpegExe, ['-hide_banner', ...args], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 })

  const frames = run(['-ss', '3', '-i', file, '-t', '8', '-map', '0:v:0', '-vf',
    'crop=iw/3:ih/3:iw/3:ih/3,scale=32:18,signalstats,metadata=mode=print:key=lavfi.signalstats.YAVG:file=-', '-f', 'null', '-'])
  const ys = [...frames.stdout.matchAll(/YAVG=([0-9.]+)/g)].map((m) => Number(m[1]))
  const mean = ys.reduce((a, b) => a + b, 0) / (ys.length || 1)
  const spread = Math.sqrt(ys.reduce((a, b) => a + (b - mean) ** 2, 0) / (ys.length || 1))

  const audio = run(['-ss', '3', '-i', file, '-t', '8', '-map', '0:a:0', '-af', 'volumedetect', '-f', 'null', '-'])
  const max = /max_volume: (-?[0-9.]+) dB/.exec(audio.stderr)
  const meanVol = /mean_volume: (-?[0-9.]+) dB/.exec(audio.stderr)
  return {
    pictureFrames: ys.length, pictureBrightnessSpread: Number(spread.toFixed(2)),
    soundMaxDb: max ? Number(max[1]) : null, soundMeanDb: meanVol ? Number(meanVol[1]) : null,
  }
}

/**
 * A recording with several audio tracks: how many streams the file has, how long
 * each is, how loud each is, and when the first beats of the test signal sound on
 * each (they must be the same on every track that carries the signal).
 */
function tracksCheck(file) {
  const ffmpegExe = path.join(root, 'resources', 'ffmpeg', 'ffmpeg.exe')
  const run = (a) => spawnSync(ffmpegExe, ['-hide_banner', ...a], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 })
  const listing = run(['-i', file]).stderr
  const streams = listing.split(/\r?\n/).filter((l) => /Stream #|title +:/.test(l)).map((l) => l.trim())
  const audioCount = streams.filter((l) => /Audio:/.test(l)).length
  const out = { streams, audioCount, tracks: [] }
  for (let i = 0; i < Math.max(audioCount, trackCount); i++) {
    const vol = run(['-i', file, '-map', `0:a:${i}`, '-af', 'volumedetect', '-f', 'null', '-'])
    const mean = /mean_volume: (-?[0-9.]+) dB/.exec(vol.stderr)
    const max = /max_volume: (-?[0-9.]+) dB/.exec(vol.stderr)
    const sil = run(['-i', file, '-map', `0:a:${i}`, '-af', 'silencedetect=n=-40dB:d=0.15', '-f', 'null', '-'])
    const onsets = [...sil.stderr.matchAll(/silence_end: ([0-9.]+)/g)].map((m) => Number(m[1])).slice(0, 8)
    let last = null
    for (const m of vol.stderr.matchAll(/time=(\d+):(\d+):([0-9.]+)/g)) last = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
    out.tracks.push({ track: i + 1, meanDb: mean ? Number(mean[1]) : null, maxDb: max ? Number(max[1]) : null, seconds: last, onsets })
  }
  return out
}

/**
 * The page: the red box is red and steady, the animated box changes colour over
 * time, and where the page paints nothing the scene behind it shows through.
 */
function pageCheck(file, outW) {
  const ffmpegExe = path.join(root, 'resources', 'ffmpeg', 'ffmpeg.exe')
  const k = outW / 1920
  const series = (x, y, w, h, key) => {
    const crop = [w, h, x, y].map((v) => Math.round(v * k)).join(':')
    const r = spawnSync(ffmpegExe, ['-hide_banner', '-ss', '3', '-i', file, '-t', '8', '-map', '0:v:0', '-vf',
      `fps=10,crop=${crop},signalstats,metadata=mode=print:file=-`, '-f', 'null', '-'],
    { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 })
    return [...r.stdout.matchAll(new RegExp('lavfi.signalstats.' + key + '=([0-9.]+)', 'g'))].map((m) => Number(m[1]))
  }
  const range = (xs) => (xs.length ? [Math.round(Math.min(...xs)), Math.round(Math.max(...xs))] : null)
  return {
    redBoxU: range(series(150, 150, 300, 200, 'UAVG')), redBoxV: range(series(150, 150, 300, 200, 'VAVG')),
    animatedBoxU: range(series(1050, 150, 300, 200, 'UAVG')),
    behindThePage: range(series(100, 700, 400, 200, 'YAVG')),
  }
}

async function waitFor(fn, what, ms = 30000) {
  const end = Date.now() + ms
  for (;;) {
    try { const v = await fn(); if (v) return v } catch { /* not yet */ }
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`)
    await sleep(250)
  }
}

let transitionAt = 0

async function main() {
  // Either the built sources run by Electron, or an installed/unpacked app (--exe=...).
  const exe = flag('exe', '')
  const electron = exe || path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
  const launchArgs = exe ? [] : [root]
  const child = spawn(electron, [...launchArgs, `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(scratch, 'profile')}`], {
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false,
  })
  let appLog = ''
  child.stdout.on('data', (d) => { appLog += d })
  child.stderr.on('data', (d) => { appLog += d })

  let ui
  try {
    const page = await waitFor(async () => (await targets()).find((t) => t.type === 'page' && /index\.html/.test(t.url)), 'the app window')
    ui = new Cdp(page.webSocketDebuggerUrl)
    await ui.ready
    const invoke = (cmd, a = {}) => ui.eval(`window.codebuilders.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(a)})`)
    log('app is up')

    // A scene with the whole screen in it, and the target saved the way the picker saves it.
    const init = await invoke('init_default_collection')
    const sceneId = init.scenes[0].id
    const screens = await invoke('list_capture_sources', { kinds: ['screen'] })
    if (!screens.length) throw new Error('No screen to capture')
    const target = { kind: 'screen', id: screens[0].id, name: screens[0].name }
    const added = await invoke('add_source', {
      sceneId, name: 'Screen', sourceType: 'display_capture',
      settings: JSON.stringify({ capture: target }),
    })
    if (overlay) {
      // A green box and a red text box over the screen; the recording must show both.
      const box = async (name, sourceType, settings, x, y, width, height) => {
        const src = await invoke('add_source', { sceneId, name, sourceType, settings: JSON.stringify(settings) })
        await invoke('set_source_transform', {
          id: src.id, transform: JSON.stringify({ x, y, width, height, rotation: 0, scaleX: 1, scaleY: 1 }),
        })
      }
      await box('Green', 'color_source', { color: '#00ff00' }, 120, 120, 480, 240)
      await box('Words', 'text_gdi_plus',
        { text: 'HELLO', fontSize: 140, bold: true, color: '#ffffff', backgroundColor: '#ff0000', align: 'center' },
        1200, 120, 600, 240)
    }
    if (filtersTest) {
      // Three boxes, each with a filter. Filters are kept in the interface page's storage.
      const stored = {}
      const box = async (name, color, x, y, w, h, filters) => {
        const src = await invoke('add_source', { sceneId, name, sourceType: 'color_source', settings: JSON.stringify({ color }) })
        await invoke('set_source_transform', {
          id: src.id, transform: JSON.stringify({ x, y, width: w, height: h, rotation: 0, scaleX: 1, scaleY: 1 }),
        })
        stored[src.id] = filters.map((f, i) => ({ id: `${name}-${i}`, name: f.type, enabled: true, ...f }))
      }
      await box('keyed', '#00ff00', 120, 120, 480, 240, [{ type: 'chroma-key', keyColor: '#00ff00', similarity: 80, smoothness: 50, opacity: 1 }])
      await box('grey', '#ff0000', 700, 120, 480, 240, [{ type: 'color-correction', brightness: 0, contrast: 1, saturation: 0, hue: 0, opacity: 1 }])
      await box('cropped', '#0000ff', 1240, 120, 560, 240, [{ type: 'crop', left: 280, right: 0, top: 0, bottom: 0 }])
      await ui.eval(`localStorage.setItem('cb:filters', ${JSON.stringify(JSON.stringify(stored))})`)
    }
    let secondScene = null
    if (transitionType) {
      // Scene 1 is all red; scene 2 is all blue. Both are drawn from settings alone, so nothing
      // on the real screen is involved.
      const first = await invoke('add_source', { sceneId, name: 'Red', sourceType: 'color_source', settings: JSON.stringify({ color: '#ff0000' }) })
      void first
      secondScene = await invoke('create_scene', { collectionId: init.collectionId, name: 'Blue scene' })
      await invoke('add_source', { sceneId: secondScene.id, name: 'Blue', sourceType: 'color_source', settings: JSON.stringify({ color: '#0000ff' }) })
      await ui.eval(`localStorage.setItem('cb:transition', JSON.stringify({ type: '${transitionType}', durationMs: 2000 }))`)
    }
    let pageServer = null
    if (webPage) {
      // A page with a still red box, a box that animates blue to green, and nothing behind them.
      const html = `<!doctype html><html><body style="margin:0;background:transparent">
        <div style="position:fixed;left:100px;top:100px;width:400px;height:300px;background:#f00"></div>
        <div style="position:fixed;left:1000px;top:100px;width:400px;height:300px;animation:shift 2s linear infinite alternate"></div>
        <style>@keyframes shift{from{background:#00f}to{background:#0f0}}</style></body></html>`
      pageServer = require('node:http').createServer((_q, res) => { res.setHeader('Content-Type', 'text/html'); res.end(html) })
      await new Promise((r) => pageServer.listen(0, '127.0.0.1', r))
      const port = pageServer.address().port
      const src = await invoke('add_source', { sceneId, name: 'Page', sourceType: 'browser_source',
        settings: JSON.stringify({ url: `http://127.0.0.1:${port}/`, width: 1920, height: 1080, fps: 30 }) })
      await invoke('set_source_transform', {
        id: src.id, transform: JSON.stringify({ x: 0, y: 0, width: 1920, height: 1080, rotation: 0, scaleX: 1, scaleY: 1 }),
      })
    }
    if (mediaFile) {
      // A video file played as a source, covering the canvas.
      const src = await invoke('add_source', { sceneId, name: 'Clip', sourceType: 'media_source', settings: JSON.stringify({ filePath: mediaFile, muted: args.includes('--media-muted'), volume: Number(flag('media-volume', 1)) }) })
      await invoke('set_source_transform', {
        id: src.id, transform: JSON.stringify({ x: 0, y: 0, width: 1920, height: 1080, rotation: 0, scaleX: 1, scaleY: 1 }),
      })
    }
    if (arrange) {
      // Half size, centred: the corners of the recording must stay black.
      await invoke('set_source_transform', {
        id: added.id,
        transform: JSON.stringify({ x: 480, y: 270, width: 960, height: 540, rotation: 0, scaleX: 1, scaleY: 1 }),
      })
    }
    await ui.eval('location.reload()')
    await sleep(2500)
    // The page reloaded: reconnect.
    ui.close()
    const page2 = await waitFor(async () => (await targets()).find((t) => t.type === 'page' && /index\.html/.test(t.url)), 'the reloaded window')
    ui = new Cdp(page2.webSocketDebuggerUrl)
    await ui.ready
    await sleep(2500) // let the interface publish the scene to the host
    log('scene ready:', target.name)

    const click = (js) => ui.eval(`(() => { ${js} })()`)
    if (transitionType) {
      await click(`const b = document.querySelector('button[title="Studio Mode"]'); if (b) b.click()`)
      await sleep(500)
      await click(`const s = document.querySelector('[aria-label="Blue scene"]'); if (s) s.click()`)
      await sleep(500)
    }

    // Connect system audio the way a user does: with the Desktop button in the mixer.
    if (withSync) {
      const clicked = await ui.eval(`(() => {
        const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Desktop')
        if (!b) return false
        b.click(); return true
      })()`)
      if (!clicked) throw new Error('No Desktop button in the mixer')
      await waitFor(() => ui.eval(`!!document.querySelector('[title="Receiving audio"]')`), 'system audio to connect', 15000)
      log('system audio connected')
      if (args.includes('--mic')) {
        const mic = await ui.eval(`(() => {
          const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Mic')
          if (!b) return false
          b.click(); return true
        })()`)
        await sleep(2500)
        log('microphone button', mic ? 'pressed' : 'not found')
      }
      await sleep(1500)
    }

    if (minimize) {
      // The protocol's window controls are not available in Electron, so minimize
      // the window the way a user would: by title, through Win32.
      const ps = [
        "Add-Type -Name W -Namespace N -MemberDefinition '[DllImport(\"user32.dll\")] public static extern System.IntPtr FindWindow(string c, string t); [DllImport(\"user32.dll\")] public static extern bool ShowWindow(System.IntPtr h, int n);'",
        "$h = [N.W]::FindWindow([NullString]::Value, 'CodeBuilders')",
        "if ($h -eq [System.IntPtr]::Zero) { Write-Output 'not-found' } else { [void][N.W]::ShowWindow($h, 6); Write-Output 'minimized' }",
      ].join('; ')
      const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' })
      if (!/minimized/.test(r.stdout)) throw new Error(`Could not minimize the window: ${r.stdout} ${r.stderr}`)
      log('interface window minimized')
    }

    const params = {
      width, height, fps, videoBitrate: 0, audioBitrate: 160000,
      encoder: 'auto', keyframeSeconds: 2, audio: true, tracks: trackCount,
    }
    params.videoBitrate = Math.round((width * height * fps * 0.097) / 100000) * 100000

    const kind = flag('kind', 'recording')
    if (!['recording', 'streaming', 'replay', 'vcam'].includes(kind)) throw new Error(`Unknown --kind=${kind}`)
    const ffmpegExe = path.join(root, 'resources', 'ffmpeg', 'ffmpeg.exe')
    let receiver = null

    let flasher = null
    if (withSync) {
      flasher = spawn(path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'),
        [path.join(__dirname, 'flasher.cjs'), `--user-data-dir=${path.join(scratch, 'flasher')}`], { stdio: 'ignore' })
      await sleep(3000)
      log('test signal on screen')
    }

    const startedAt = Date.now()
    let file = outFile
    if (kind === 'recording') {
      const folder = flag('folder', '')
      if (folder) {
        log('recording folder set to', await invoke('set_recording_folder', { folder }))
        file = await invoke('start_recording', { format: 'mkv', params }) // no path: the folder decides
      } else {
        file = await invoke('start_recording', { outputPath: outFile, format: 'mkv', params })
      }
    } else if (kind === 'streaming') {
      // A local RTMP server to stream to: FFmpeg listening, writing what arrives to a file.
      file = path.join(scratch, 'received.flv')
      receiver = spawn(ffmpegExe, ['-hide_banner', '-y', '-listen', '1', '-i', 'rtmp://127.0.0.1:1935/live/e2e', '-c', 'copy', file], { stdio: 'ignore' })
      await sleep(1500)
      await invoke('start_streaming', { rtmpUrl: 'rtmp://127.0.0.1:1935/live', streamKey: 'e2e', params })
    } else if (kind === 'replay') {
      await invoke('start_replay_buffer', { bufferSecs: 20, params })
    } else if (kind === 'vcam') {
      file = path.join(scratch, 'vcam.mkv')
      const url = await invoke('start_virtual_camera', { params })
      receiver = spawn(ffmpegExe, ['-hide_banner', '-y', '-i', url + '?fifo_size=5000000&overrun_nonfatal=1', '-c', 'copy', file], { stdio: 'ignore' })
    }
    log(kind, 'started', file, `(${params.width}x${params.height}@${params.fps}, ${params.videoBitrate / 1e6} Mbps)`)

    // Watch the host while it works.
    const hostPage = (await targets()).find((t) => /host\.html/.test(t.url))
    log(hostPage ? 'host window present' : 'NO HOST WINDOW')

    const hostCdp = hostPage ? new Cdp(hostPage.webSocketDebuggerUrl) : null
    await hostCdp?.ready
    if (transitionType) {
      await sleep(4000)
      log('before:', await ui.eval(`JSON.stringify({
        scenes: [...document.querySelectorAll('[role=button][aria-label]')].map((b) => [b.getAttribute('aria-label'), b.getAttribute('aria-current')]).slice(0, 8),
        transition: (() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Transition'); return b ? { disabled: b.disabled } : null })(),
      })`))
      await click(`const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Transition'); if (b) b.click()`)
      log('transition triggered (' + transitionType + ')')
      transitionAt = (Date.now() - startedAt) / 1000
    }
    // Run a script inside the output host and print what it returns (for experiments).
    const probeFile = flag('probe', '')
    if (probeFile && hostCdp) {
      const result = await hostCdp.eval(fs.readFileSync(path.resolve(probeFile), 'utf8'))
      console.log('PROBE:', typeof result === 'string' ? result : JSON.stringify(result))
    }
    if (weakCores) {
      await sleep(3000)
      restrictCpu(scratch, weakCores)
      log(`limited to ${weakCores} core(s) at low priority`)
    }
    const memory = []
    let lastAudio = null
    let warnedAt = 0
    let samples = 0
    let lastCpu = null
    while (Date.now() - startedAt < seconds * 1000) {
      await sleep(5000)
      if (child.exitCode !== null) throw new Error('The app exited during the recording')
      if (samples % 3 === 1) {
        const now = cpuSeconds(scratch)
        const at = Date.now()
        if (lastCpu) {
          const wall = (at - lastCpu.at) / 1000
          const rows = Object.entries(now).map(([k, v]) => [k, (v - (lastCpu.v[k] ?? v)) / wall]).filter(([, c]) => c > 0.03).sort((a, b) => b[1] - a[1])
          log('cpu (cores):', rows.map(([k, c]) => `${k}=${c.toFixed(2)}`).join(' '))
        }
        lastCpu = { v: now, at }
      }
      if (++samples % 3 === 0) {
        const mb = memoryMb(scratch)
        memory.push(mb)
        log(`memory: ${mb} MB across the app's processes`)
      }
      if (args.includes('--footer')) log('footer:', String(await ui.eval(`[...document.querySelectorAll('footer')].map((f) => f.textContent).join('')`)).slice(0, 220))
      if (weakCores && !warnedAt && await ui.eval(`document.body.innerText.includes('not keeping up')`)) {
        warnedAt = (Date.now() - startedAt) / 1000
        log('warning appeared at', warnedAt.toFixed(1), 's')
      }
      if (hostCdp) {
        const d = await hostCdp.eval(`JSON.stringify(window.__host.debug())`).then(JSON.parse)
        const a = d.audio
        if (a) log(`audio: ${a.inputs} input(s), ${a.blocks} blocks, ${a.blocksSentLate} late, clock offset ${a.offsetMs === null ? 'n/a' : Math.round(a.offsetMs)} ms`)
        const c = d.captures[0]
        const sess = d.sessions[0]
        log('host:', c ? `capture ${c.state} t=${c.time.toFixed(1)} ${c.width}x${c.height} rs=${c.readyState} ${c.error || ''}` : 'no capture',
          sess ? `| compose=${sess.composeMs.toFixed(1)}ms submit=${sess.submitMs.toFixed(1)}ms worst=${sess.worstMs.toFixed(0)}ms in=${sess.framesIn} dropped=${sess.framesDropped} audioBlocks=${sess.audioBlocks} silence=${sess.silenceFrames} trim=${sess.trimmedFrames} hw=${sess.hardware}` : '')
      }
    }

    if (weakCores) {
      const warned = await ui.eval(`document.body.innerText.includes('not keeping up')`)
      const bar = await ui.eval(`(() => { const f = [...document.querySelectorAll('footer span')].map((e) => e.textContent); return f.join('|') })()`)
      log('warning shown to the user:', warned || warnedAt > 0)
      log('status bar:', String(bar).slice(0, 200))
    }
    if (kind === 'recording') await invoke('stop_recording')
    else if (kind === 'streaming') await invoke('stop_streaming')
    else if (kind === 'vcam') await invoke('stop_virtual_camera')
    else if (kind === 'replay') {
      file = await invoke('save_replay', { outputPath: path.join(scratch, 'replay.mkv') })
      await invoke('stop_replay_buffer')
    }
    if (receiver) { await sleep(1500); receiver.kill('SIGINT'); await sleep(1500) }
    if (flasher) { spawnSync('taskkill', ['/F', '/T', '/PID', String(flasher.pid)], { windowsHide: true }) }
    log('stopped; recorded for', ((Date.now() - startedAt) / 1000).toFixed(1), 's')
    await sleep(1500)
    if (args.includes('--show-log')) console.log('--- app output ---', appLog.slice(-3000))
    return { file, wallSeconds: (Date.now() - startedAt) / 1000, appLog, memory }
  } catch (e) {
    if (appLog.trim()) console.error('--- app output (last 2000 characters) ---', appLog.slice(-2000))
    throw e
  } finally {
    ui?.close()
    child.kill()
    await sleep(800)
    spawnSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { windowsHide: true })
  }
}

main()
  .then((r) => {
    const size = fs.existsSync(r.file) ? fs.statSync(r.file).size : 0
    log(`file: ${r.file} (${(size / 1e6).toFixed(1)} MB)`)
    if (size === 0) {
      console.log('--- app log ---\n' + r.appLog.slice(-3000))
      process.exit(1)
    }
    if (overlay) console.log(JSON.stringify(overlayCheck(r.file, width, height)))
    if (mediaFile) console.log(JSON.stringify(mediaCheck(r.file)))
    if (webPage) console.log(JSON.stringify(pageCheck(r.file, width)))
    if (trackCount > 1) console.log(JSON.stringify(tracksCheck(r.file), null, 1))
    if (transitionType) console.log(JSON.stringify(transitionCheck(r.file, width, height, transitionAt)))
    if (filtersTest) console.log(JSON.stringify(filtersCheck(r.file, width)))
    if (arrange || args.includes('--check')) console.log(JSON.stringify(arrangeCheck(r.file)))
    const analyze = spawnSync('node', [path.join(root, 'spike', 'pipeline', 'analyze.cjs'), r.file, String(fps)], { encoding: 'utf8' })
    console.log(analyze.stdout || analyze.stderr)
    // The recording is of the real screen and may show private things; it is
    // measured, not looked at, and removed unless asked to keep it.
    if (args.includes('--keep')) console.log(`(kept ${r.file}; delete ${scratch} when done)`)
    else fs.rmSync(scratch, { recursive: true, force: true })
  })
  .catch((e) => {
    console.error('E2E FAILED:', e.message)
    if (!args.includes('--keep')) fs.rmSync(scratch, { recursive: true, force: true })
    process.exit(1)
  })
