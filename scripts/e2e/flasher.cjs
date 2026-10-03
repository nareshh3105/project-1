'use strict'
/**
 * A full-screen test signal for the sync check: every two seconds the screen
 * flashes white and a 1 kHz beep plays, both scheduled from the same audio
 * clock. Any offset between flash and beep in a recording was added by the
 * recording path, and an offset that grows is drift.
 *
 * Run with Electron: electron scripts/e2e/flasher.cjs
 */
const { app, BrowserWindow } = require('electron')

app.whenReady().then(() => {
  const win = new BrowserWindow({
    fullscreen: true, frame: false, backgroundColor: '#000', show: true, alwaysOnTop: true,
    webPreferences: { autoplayPolicy: 'no-user-gesture-required', backgroundThrottling: false },
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.focus()
  const page = `<body style="margin:0;background:#000"><script>
    const ac = new AudioContext()
    const t0 = ac.currentTime + 1
    for (let k = 0; k < 400; k++) {
      const o = ac.createOscillator(), g = ac.createGain()
      o.frequency.value = 1000; g.gain.value = 0.6
      o.connect(g); g.connect(ac.destination)
      o.start(t0 + 2 * k); o.stop(t0 + 2 * k + 0.12)
    }
    const tick = () => {
      const t = ac.currentTime - t0
      document.body.style.background = t >= 0 && ((t % 2) < 0.12) ? '#fff' : '#000'
      requestAnimationFrame(tick)
    }
    tick()
  </script></body>`
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page))
})
app.on('window-all-closed', () => app.quit())
