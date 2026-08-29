import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * AppMenu renders its drawer overlay (`position: absolute; inset: 0`) as a
 * sibling of the hamburger, wherever that hamburger is mounted — the topbar on
 * chat/onboard, each view's own header elsewhere. So the overlay's box is
 * decided by the nearest POSITIONED ancestor, which has to be `.shell` (the
 * whole app surface).
 *
 * 2026-08-29: `.topbar` was `position: relative`, so the drawer collapsed into
 * the ~56px header row instead of covering the app. Verified fixed in headless
 * Chrome (overlay 900px = `.shell`, `offsetParent` = `WTWApp_shell`). Nothing
 * in CSS enforces it, and adding `position` to any of these three rules brings
 * the bug straight back — hence this test.
 */

const CSS = {
  '.topbar': 'src/modules/session/components/WTWApp.module.css',
  '.header (recommendations)': 'src/modules/session/recommendations/RecommendationsView.module.css',
  '.header (ratings)': 'src/modules/session/ratings/RatingsView.module.css',
  // /profile/dna is a standalone route with no .shell wrapper, so the overlay
  // resolves all the way to the initial containing block. Every ancestor it
  // passes has to stay unpositioned.
  '.header (dna)': 'src/app/profile/dna/dna.module.css',
} as const

/** The body of the first `.<name> {…}` rule in `css`. */
function ruleBody(css: string, selector: string): string {
  const m = new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`).exec(css)
  if (!m) throw new Error(`rule ${selector} not found`)
  return m[1]
}

describe('drawer overlay containing block', () => {
  it('.shell is positioned — it is the box the overlay is meant to fill', () => {
    const css = readFileSync(join(process.cwd(), CSS['.topbar']), 'utf8')
    expect(ruleBody(css, '.shell')).toMatch(/position:\s*relative/)
  })

  it.each([
    ['.topbar', CSS['.topbar'], '.topbar'],
    ['.header (recommendations)', CSS['.header (recommendations)'], '.header'],
    ['.header (ratings)', CSS['.header (ratings)'], '.header'],
    ['.header (dna)', CSS['.header (dna)'], '.header'],
    ['.page (dna)', CSS['.header (dna)'], '.page'],
    ['.container (dna)', CSS['.header (dna)'], '.container'],
  ])('%s stays unpositioned so the overlay resolves to .shell', (_label, file, selector) => {
    const body = ruleBody(readFileSync(join(process.cwd(), file), 'utf8'), selector)
    expect(body).not.toMatch(/position:\s*(relative|absolute|fixed|sticky)/)
  })

  it('the overlay still fills its containing block', () => {
    const body = ruleBody(readFileSync(join(process.cwd(), CSS['.topbar']), 'utf8'), '.userMenuOverlay')
    expect(body).toMatch(/position:\s*absolute/)
    expect(body).toMatch(/inset:\s*0/)
  })
})
