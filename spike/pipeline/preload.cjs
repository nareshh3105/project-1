'use strict'
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('spike', {
  onConfig: (cb) => ipcRenderer.on('config', (_e, cfg) => cb(cfg)),
  onStop: (cb) => ipcRenderer.on('stop', () => cb()),
  chunk: (buffer) => ipcRenderer.send('chunk', buffer),
  stats: (s) => ipcRenderer.send('stats', s),
  started: () => ipcRenderer.send('started'),
  done: (final) => ipcRenderer.send('done', final),
  fatal: (message) => ipcRenderer.send('fatal', message),
})
