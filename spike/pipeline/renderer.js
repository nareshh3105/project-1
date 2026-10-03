'use strict'
/*
 * Composes a test scene on a canvas, mixes audio, and hands both to a
 * recording engine (MediaRecorder or WebCodecs) whose output goes to the main
 * process.
 *
 * The scene is built so the OUTPUT FILE can be checked without watching it:
 *  - every frame differs (moving bar, counter), so an idle encoder cannot hide drops;
 *  - the whole frame flashes white for 100 ms at each whole second from 1 s;
 *  - a 1 kHz beep plays at exactly the same instants, over digital silence.
 * Comparing flash times with beep times in the file measures A/V sync and
 * drift; counting frames and their gaps measures drops.
 */
const api = window.spike

api.onConfig((cfg) => {
  start(cfg).catch((err) => api.fatal(String(err && err.stack ? err.stack : err)))
})

// ── Engine: MediaRecorder ────────────────────────────────────────────────
function createMediaRecorderEngine({ vtrack, atrack, cfg, emit }) {
  const audioCodec = cfg.audio === 'off' ? '' : ',opus'
  const mimeType = `video/webm;codecs=${cfg.codec}${audioCodec}`
  if (!MediaRecorder.isTypeSupported(mimeType)) throw new Error(`MediaRecorder does not support ${mimeType}`)

  const tracks = cfg.audio === 'off' ? [vtrack] : [vtrack, atrack]
  const recorder = new MediaRecorder(new MediaStream(tracks), {
    mimeType,
    videoBitsPerSecond: cfg.bitrate,
    audioBitsPerSecond: 160000,
  })
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size) emit(e.data.arrayBuffer())
  }

  // A second consumer that only counts frames: if it sees every one, the
  // capture side is healthy and any loss is in the encoder.
  let probeFrames = 0
  if (cfg.probe === 'on' && 'MediaStreamTrackProcessor' in window) {
    const reader = new MediaStreamTrackProcessor({ track: vtrack.clone() }).readable.getReader()
    ;(async () => {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        probeFrames++
        value.close()
      }
    })()
  }

  return {
    mimeType,
    start() { recorder.start(250) },
    stop() {
      return new Promise((resolve) => {
        recorder.onstop = () => resolve()
        recorder.stop()
      })
    },
    stats: () => ({ probeFrames }),
  }
}

async function start(cfg) {
  const W = cfg.width
  const H = cfg.height
  const frameMs = 1000 / cfg.fps

  const canvas = document.getElementById('c')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d', { alpha: false })

  // ── Optional real screen capture as a layer, like the app's display source ──
  let screenVideo = null
  if (cfg.layers === 'screen') {
    const screen = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: cfg.fps },
      audio: false,
    })
    screenVideo = document.createElement('video')
    screenVideo.muted = true
    screenVideo.srcObject = screen
    await screenVideo.play()
  }

  // ── Audio: digital silence with a beep at each whole second ──
  const ac = new AudioContext({ sampleRate: 48000 })
  await ac.resume()
  const dest = ac.createMediaStreamDestination()
  const osc = ac.createOscillator()
  osc.frequency.value = 1000
  const gain = ac.createGain()
  gain.gain.value = 0
  osc.connect(gain).connect(dest)
  osc.start()

  // Tie the context to the hardware audio clock by also routing it, silently,
  // to the real output. Without a device in the graph the clock can fall behind
  // real time when the window is minimized.
  if (cfg.audiosink === 'device') {
    const silent = ac.createGain()
    silent.gain.value = 0
    gain.connect(silent).connect(ac.destination)
  }

  // ── Video track, one frame pushed per draw ──
  // manual: one frame pushed per draw. auto: the browser samples the canvas.
  const videoStream = cfg.capture === 'auto' ? canvas.captureStream(cfg.fps) : canvas.captureStream(0)
  const vtrack = videoStream.getVideoTracks()[0]
  const atrack = dest.stream.getAudioTracks()[0]

  // Chunks must reach the encoder in order; chain them.
  let queue = Promise.resolve()
  let chunks = 0
  let bytes = 0
  const emit = (bufferOrPromise) => {
    queue = queue.then(async () => {
      const buffer = await bufferOrPromise
      chunks++
      bytes += buffer.byteLength
      api.chunk(buffer)
    })
  }

  // WebCodecs takes the canvas and the audio graph directly and timestamps both
  // itself; MediaRecorder is handed the two captured tracks.
  const engine =
    cfg.engine === 'webcodecs'
      ? await (await import('./webcodecs.js')).createEngine({
          canvas, ac, audioSource: gain, sink: dest, cfg, emit,
        })
      : createMediaRecorderEngine({ vtrack, atrack, cfg, emit })

  // ── The scene ──
  let n = 0
  let drawn = 0
  let skipped = 0
  let lastTick = performance.now()
  let maxGap = 0
  let bigGaps = 0
  let running = false
  let pStart = 0

  function draw(t) {
    const x = (t / 8) % W
    const g = ctx.createLinearGradient(x, 0, x + W, H)
    g.addColorStop(0, '#1b4b8f')
    g.addColorStop(1, '#8f1b6b')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)

    if (screenVideo) ctx.drawImage(screenVideo, 0, 0, W, H)

    // A webcam-sized layer: a rotating panel and a text block.
    ctx.save()
    ctx.translate(W - 340, 240)
    ctx.rotate(t / 700)
    ctx.fillStyle = 'rgba(255,255,255,0.35)'
    ctx.fillRect(-160, -90, 320, 180)
    ctx.restore()

    ctx.fillStyle = '#fff'
    ctx.fillRect((n * 12) % W, H - 80, 220, 40)
    ctx.font = '64px monospace'
    ctx.fillText(`F${n}  ${(t / 1000).toFixed(2)}s`, 60, 100)

    // The sync marker: full white for 100 ms at each whole second from 1 s.
    if (t >= 1000 && t % 1000 < 100) {
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, W, H)
    }
  }

  function tick(now) {
    const gap = now - lastTick
    lastTick = now
    if (gap > maxGap) maxGap = gap
    if (gap > 100) bigGaps++
    draw(now - pStart)
    n++
    drawn++
    if (cfg.engine === 'webcodecs') engine.submitFrame(now)
    else if (cfg.capture !== 'auto') vtrack.requestFrame()
  }

  // Self-correcting schedule: a plain setInterval of 33 ms would run at 30.3 fps.
  let due = 0
  function step() {
    const now = performance.now()
    if (now >= due) {
      // More than a frame behind: skip rather than burst to catch up.
      const behind = Math.floor((now - due) / frameMs)
      if (behind >= 1) { skipped += behind; due += behind * frameMs }
      tick(now)
      due += frameMs
    }
  }
  function loopTimer() {
    if (!running) return
    step()
    setTimeout(loopTimer, Math.max(0, due - performance.now()))
  }
  function loopRaf() {
    if (!running) return
    step()
    requestAnimationFrame(loopRaf)
  }

  // ── Go ──
  const acNow = ac.currentTime
  const total = cfg.duration + (cfg.delay || 0) + 5
  for (let k = 1; k <= total; k++) {
    gain.gain.setValueAtTime(1, acNow + k)
    gain.gain.setValueAtTime(0, acNow + k + 0.1)
  }

  pStart = performance.now()
  due = pStart
  running = true
  if (cfg.driver === 'raf') requestAnimationFrame(loopRaf)
  else loopTimer()

  // The page can draw for a while before recording starts, to separate the
  // cost of a freshly opened window from the cost of the recorder itself.
  setTimeout(() => {
    engine.start()
    api.started()
  }, (cfg.delay || 0) * 1000)

  // Provoke garbage collection, to expose objects that are only alive by luck.
  let gcCalls = 0
  const gcAvailable = typeof window.gc === 'function'
  if (cfg.gc === 'on' && gcAvailable) {
    setInterval(() => { window.gc(); gcCalls++ }, 10000)
  }

  // ── Report once a second ──
  const reporter = setInterval(() => {
    api.stats({
      t: (performance.now() - pStart) / 1000,
      drawn, skipped, maxGap, bigGaps, chunks, bytes,
      visibility: document.visibilityState,
      diag: engine.diagnostics ? engine.diagnostics() : null,
    })
    maxGap = 0
  }, 1000)

  api.onStop(async () => {
    running = false
    clearInterval(reporter)
    await engine.stop()
    await queue
    api.done({
      mimeType: engine.mimeType,
      engine: cfg.engine,
      drawn, skipped, bigGaps, chunks, bytes,
      engineStats: { ...engine.stats(), gcAvailable, gcCalls },
      seconds: (performance.now() - pStart) / 1000,
      expectedDraws: Math.round(((performance.now() - pStart) / 1000) * cfg.fps),
    })
  })
}
