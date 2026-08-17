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

      // A ratchet, not the target. NF-13 in the SRS commits the backend to 70%
      // of statements; these numbers sit just under what is currently achieved
      // so coverage cannot silently regress, and should be raised as the
      // remaining modules gain tests. See docs/TESTING.md for what is left.
      thresholds: {
        statements: 28,
        branches: 75,
        functions: 50,
        lines: 28,
      },
    },
  },
})
