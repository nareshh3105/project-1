import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // The main process imports 'electron' for app paths, dialogs and the
      // window. None of that exists outside a running Electron host, so tests
      // resolve it to a stub instead.
      electron: path.resolve(__dirname, 'test/mocks/electron.ts'),
    },
  },

  test: {
    globals: true,
    // Node by default — most of what is worth testing is main-process logic.
    // Renderer suites opt into jsdom with a per-file docblock:
    //   // @vitest-environment jsdom
    environment: 'node',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    setupFiles: ['test/setup.ts'],

    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['electron/**/*.ts', 'src/stores/**/*.ts', 'src/lib/**/*.ts'],
      exclude: [
        '**/*.d.ts',
        'electron/preload/**',
        // Process and window lifecycle: nothing here runs without an Electron
        // host, and mocking one deep enough to be meaningful would test the
        // mock rather than the application.
        'electron/main/index.ts',
        'electron/main/commands/index.ts',
      ],

      thresholds: {
        // NF-13 commits the backend process to 70% of statements. Enforced on
        // the backend specifically, so renderer code that has not been covered
        // yet cannot dilute the number into looking met when it is not.
        'electron/main/**': {
          statements: 70,
          branches: 70,
          functions: 70,
          lines: 70,
        },

        // Files not matched by a glob above — the renderer stores and helpers.
        // A ratchet just under current to stop regression, not a target. Raise
        // as those gain tests; see docs/TESTING.md.
        statements: 13,
        branches: 60,
        functions: 35,
        lines: 13,
      },
    },
  },
})
