import { afterEach, vi } from 'vitest'

// DOM matchers (toBeDisabled, toBeVisible, ...). Registering them is harmless
// in the Node-environment suites, which simply never use them.
import '@testing-library/jest-dom/vitest'

afterEach(() => {
  vi.restoreAllMocks()
})
