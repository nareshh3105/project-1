'use strict'
/**
 * End-to-end check of the real app: launches the built application with a fresh
 * profile, drives it over the DevTools protocol, records the screen and the
 * system audio for a while with the interface window minimized, and measures
 * the file.
 *
 *   node scripts/e2e/record.cjs [seconds] [--fps=30] [--res=1280x720] [--no-minimize]
 *                               [--kind=recording|replay|streaming] [--keep]
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

async function waitFor(fn, what, ms = 30000) {
  const end = Date.now() + ms
  for (;;) {
    try { const v = await fn(); if (v) return v } catch { /* not yet */ }
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`)
    await sleep(250)
  }
}

async function main() {
  const electron = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
  const child = spawn(electron, [root, `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(scratch, 'profile')}`], {
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
    await invoke('add_source', {
      sceneId, name: 'Screen', sourceType: 'display_capture',
      settings: JSON.stringify({ capture: target }),
    })
    await ui.eval('location.reload()')
    await sleep(2500)
    // The page reloaded: reconnect.
    ui.close()
    const page2 = await waitFor(async () => (await targets()).find((t) => t.type === 'page' && /index\.html/.test(t.url)), 'the reloaded window')
    ui = new Cdp(page2.webSocketDebuggerUrl)
    await ui.ready
    await sleep(2500) // let the interface publish the scene to the host
    log('scene ready:', target.name)

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
      encoder: 'auto', keyframeSeconds: 2, audio: true,
    }
    params.videoBitrate = Math.round((width * height * fps * 0.097) / 100000) * 100000

    const kind = flag('kind', 'recording')
    if (kind !== 'recording') throw new Error(`--kind=${kind} is not wired into this script yet`)

    let flasher = null
    if (withSync) {
      flasher = spawn(path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'),
        [path.join(__dirname, 'flasher.cjs'), `--user-data-dir=${path.join(scratch, 'flasher')}`], { stdio: 'ignore' })
      await sleep(3000)
      log('test signal on screen')
    }

    const startedAt = Date.now()
    const file = await invoke('start_recording', { outputPath: outFile, format: 'mkv', params })
    log('recording to', file, `(${params.width}x${params.height}@${params.fps}, ${params.videoBitrate / 1e6} Mbps)`)

    // Watch the host while it works.
    const hostPage = (await targets()).find((t) => /host\.html/.test(t.url))
    log(hostPage ? 'host window present' : 'NO HOST WINDOW')

    const hostCdp = hostPage ? new Cdp(hostPage.webSocketDebuggerUrl) : null
    await hostCdp?.ready
    const memory = []
    let lastAudio = null
    let samples = 0
    while (Date.now() - startedAt < seconds * 1000) {
      await sleep(5000)
      if (child.exitCode !== null) throw new Error('The app exited during the recording')
      if (++samples % 3 === 0) {
        const mb = memoryMb(scratch)
        memory.push(mb)
        log(`memory: ${mb} MB across the app's processes`)
      }
      if (hostCdp) {
        const d = await hostCdp.eval(`JSON.stringify(window.__host.debug())`).then(JSON.parse)
        const a = d.audio
        if (a) {
          if (lastAudio) log(`audio clock: ${(((a.ctxSec - lastAudio.ctxSec) * 1000) / (a.perfMs - lastAudio.perfMs) * 100).toFixed(2)}% of real time (${a.state})`)
          lastAudio = a
        }
        const c = d.captures[0]
        const sess = d.sessions[0]
        log('host:', c ? `capture ${c.state} t=${c.time.toFixed(1)} ${c.width}x${c.height} rs=${c.readyState} ${c.error || ''}` : 'no capture',
          sess ? `| in=${sess.framesIn} dropped=${sess.framesDropped} audioBlocks=${sess.audioBlocks} silence=${sess.silenceFrames} trim=${sess.trimmedFrames} hw=${sess.hardware}` : '')
      }
    }

    await invoke('stop_recording')
    if (flasher) { spawnSync('taskkill', ['/F', '/T', '/PID', String(flasher.pid)], { windowsHide: true }) }
    log('stopped; recorded for', ((Date.now() - startedAt) / 1000).toFixed(1), 's')
    await sleep(1500)
    return { file: outFile, wallSeconds: (Date.now() - startedAt) / 1000, appLog, memory }
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
    const analyze = spawnSync('node', [path.join(root, 'spike', 'pipeline', 'analyze.cjs'), r.file, String(fps)], { encoding: 'utf8' })
    console.log(analyze.stdout || analyze.stderr)
    if (!args.includes('--keep')) console.log(`(kept ${r.file}; delete ${scratch} when done)`)
  })
  .catch((e) => {
    console.error('E2E FAILED:', e.message)
    process.exit(1)
  })
