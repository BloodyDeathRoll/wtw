// Runs before every test file (see vitest.config.ts `setupFiles`).
// Adds jest-dom matchers (toBeInTheDocument, toBeDisabled, …) and resets
// all mocks between tests so state never leaks across files.
import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()        // unmount React trees between tests
  vi.clearAllMocks()
})
