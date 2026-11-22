import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// Only the Find-more button and For you's Refresh (v3 F1) may ask session/end
// for the next batch (`more: true`); the warm-up and leave-cards calls must stay no-ops.
// Source-level check, like no-viewport-units.test.ts — WTWApp has no render harness.

const src = readFileSync('src/modules/session/components/WTWApp.tsx', 'utf8')

describe('WTWApp → session/end `more`', () => {
  it('sends `more` from opts, defaulting to false', () => {
    expect(src).toMatch(/more:\s*opts\?\.more === true/)
  })

  it('only onFindMore and onRefresh pass more: true', () => {
    const calls = [...src.matchAll(/endSessionAndGenerate\(([^)]*)\)/g)].map((m) => m[1])
    const withMore = calls.filter((c) => /more:\s*true/.test(c))
    expect(withMore).toHaveLength(2)
    expect(src).toMatch(/onFindMore=\{\(\) => endSessionAndGenerate\(\{ skipTranscript: true, more: true \}\)\}/)
    expect(src).toMatch(/onRefresh=\{forYouV3Enabled\(\) \? \(\) => endSessionAndGenerate\(\{ skipTranscript: true, more: true, refresh: true \}\) : undefined\}/)
  })

  it('sends `refresh` only when asked (For you\'s Refresh)', () => {
    expect(src).toMatch(/refresh:\s*opts\?\.refresh === true/)
    const calls = [...src.matchAll(/endSessionAndGenerate\(([^)]*)\)/g)].map((m) => m[1])
    expect(calls.filter((c) => /refresh:\s*true/.test(c))).toHaveLength(1)
  })
})
