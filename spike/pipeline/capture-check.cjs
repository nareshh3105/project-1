'use strict'
/*
 * Does getDisplayMedia work in this Electron with NO request handler, as in the
 * app today? Prints the outcome and exits.
 *
 *   electron spike/pipeline/capture-check.cjs [--handler]
 */
const { app, BrowserWindow, session, desktopCapturer } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'cb-capcheck-')))
const withHandler = process.argv.includes('--handler')

app.whenReady().then(async () => {
  if (withHandler) {
    session.defaultSession.setDisplayMediaRequestHandler((_req, cb) => {
      desktopCapturer.getSources({ types: ['screen', 'window'] }).then((s) => cb({ video: s[0] }))
    })
  }

  const win = new BrowserWindow({ width: 400, height: 300, show: true })
  // A real file page: mediaDevices does not exist on a data: URL.
  await win.loadFile(path.join(__dirname, 'blank.html'))

  const result = await win.webContents.executeJavaScript(`
    (async () => {
      try {
        const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
        const t = s.getVideoTracks()[0]
        const out = 'OK: ' + t.label + ' ' + JSON.stringify(t.getSettings())
        s.getTracks().forEach(t => t.stop())
        return out
      } catch (e) {
        return 'FAILED: ' + e.name + ': ' + e.message
      }
    })()
  `, true)

  console.log(`handler=${withHandler} -> ${result}`)
  app.quit()
})
