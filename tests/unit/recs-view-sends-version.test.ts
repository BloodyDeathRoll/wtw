import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// RecommendationsView pages with the taste_version its offset belongs to
// (GET /api/recommendations/generate?v=…), takes the version from each
// response, and forgets it with the offset on every reset — so a page from a
// replaced batch restarts at the top instead of its tail (2026-11-05).

const src = readFileSync('src/modules/session/recommendations/RecommendationsView.tsx', 'utf8')

describe('RecommendationsView — the offset carries its version', () => {
  it('sends v= only once a version is known', () => {
    expect(src).toMatch(/versionRef\.current == null \? "" : `&v=\$\{versionRef\.current\}`/)
    expect(src).toMatch(/offset=\$\{offsetRef\.current\}\$\{v\}/)
  })

  it('takes the version from the response and stores next_offset with it', () => {
    expect(src).toMatch(/if \(data\.taste_version != null\) versionRef\.current = data\.taste_version;/)
    expect(src).toMatch(/offsetRef\.current = data\.next_offset;/)
  })

  it('forgets the version wherever the offset is reset to 0', () => {
    const resets = src.match(/offsetRef\.current = 0;[^\n]*\n(?:[^\n]*\n){0,2}/g) ?? []
    expect(resets.length).toBeGreaterThan(0)
    // The reset effect clears both; "Find more" sets the offset to 0 and keeps
    // the version (the server restarts at 0 either way).
    expect(src).toMatch(/offsetRef\.current = 0;\n\s*versionRef\.current = null;/)
  })
})
