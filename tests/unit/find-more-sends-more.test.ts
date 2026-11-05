import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// Only the Find-more button may ask session/end for the next batch
// (`more: true`); the warm-up and leave-cards calls must stay no-ops.
// Source-level check, like no-viewport-units.test.ts — WTWApp has no render harness.

const src = readFileSync('src/modules/session/components/WTWApp.tsx', 'utf8')

describe('WTWApp → session/end `more`', () => {
  it('sends `more` from opts, defaulting to false', () => {
    expect(src).toMatch(/more:\s*opts\?\.more === true/)
  })

  it('only onFindMore passes more: true', () => {
    const calls = [...src.matchAll(/endSessionAndGenerate\(([^)]*)\)/g)].map((m) => m[1])
    const withMore = calls.filter((c) => /more:\s*true/.test(c))
    expect(withMore).toHaveLength(1)
    expect(src).toMatch(/onFindMore=\{\(\) => endSessionAndGenerate\(\{ skipTranscript: true, more: true \}\)\}/)
  })
})
