import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// Test harness for WTW.
// - `unit`    → pure logic (node env, no DOM)  — scoring, DNA updaters, lib utils
// - `component` → React components (jsdom + RTL)
// The `@/…` alias mirrors tsconfig so tests import exactly like app code.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // jsdom so component tests get a DOM; pure unit tests don't care.
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    // App code is what we measure; the harness and mocks aren't the target.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.d.ts', 'src/types/**'],
    },
  },
})
