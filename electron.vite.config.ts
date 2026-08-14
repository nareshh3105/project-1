import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// The package is "type": "module", so main and preload are emitted as ESM
// rather than the CommonJS electron-vite defaults to. Electron 43 loads an
// ESM main process natively; an ESM preload additionally requires the .mjs
// extension, which is why the two differ below.
//
// The `as never` on the build blocks is an upstream typing mismatch, not a
// silenced mistake: electron-vite 5 declares build options against Vite 6/7's
// BuildEnvironmentOptions, while this project is on Vite 5, so `outDir` and
// `rollupOptions` fail to resolve even though Vite accepts both at runtime.
// Remove the casts once Vite is upgraded.

export default defineConfig({
  main: {
    // Native and Node-only modules stay external — bundling better-sqlite3
    // would break resolution of its .node binding.
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: path.resolve(__dirname, 'electron/main/index.ts'),
        output: { format: 'es', entryFileNames: 'index.js' },
      },
    } as never,
    resolve: {
      alias: { '@main': path.resolve(__dirname, 'electron/main') },
    },
  },

  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: path.resolve(__dirname, 'electron/preload/index.ts'),
        output: { format: 'es', entryFileNames: 'index.mjs' },
      },
    } as never,
  },

  renderer: {
    root: '.',
    plugins: [react()],
    resolve: {
      alias: { '@': path.resolve(__dirname, 'src') },
    },
    build: {
      outDir: 'out/renderer',
      // index.html lives at the repo root rather than electron-vite's
      // conventional src/renderer, so the entry has to be named explicitly.
      rollupOptions: { input: path.resolve(__dirname, 'index.html') },
    } as never,
    server: { port: 1420, strictPort: true },
  },
})
