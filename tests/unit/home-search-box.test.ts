import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// Search from the home header (2026-11-07): the search icon took the share
// icon's place; tapping it sweeps /search's field into the header and hands
// over to /search, whose field sits in its header at the same spot.
// Source-level check, like find-more-sends-more.test.ts — WTWApp has no render harness.

const app = readFileSync('src/modules/session/components/WTWApp.tsx', 'utf8')
const css = readFileSync('src/modules/session/components/WTWApp.module.css', 'utf8')
const search = readFileSync('src/app/search/SearchView.tsx', 'utf8')
const searchCss = readFileSync('src/app/search/search.module.css', 'utf8')

describe('header search', () => {
  it('the search icon replaced share in the header; no box under the circles', () => {
    expect(app).not.toMatch(/shareApp|ShareIcon|I\.share\b/)
    expect(app).toMatch(/onClick=\{onOpenSearch\}\s*aria-label="search"/)
    expect(app).not.toMatch(/HomeSearch/)
  })

  it('the field sweeps in inside the header, focused as it mounts', () => {
    expect(app).toMatch(/\{searchOpen && \(\s*<div className=\{styles\.topbarSearch\}>/)
    const overlay = app.slice(app.indexOf('{searchOpen && ('), app.indexOf('</form>', app.indexOf('{searchOpen && (')))
    expect(overlay).toMatch(/className=\{sx\.headerInput\}/)
    expect(overlay).toMatch(/autoFocus/)
    expect(css).toMatch(/\.topbarSearch \{[\s\S]*?position: absolute;[\s\S]*?right: 57px;[\s\S]*?animation: sweepIn/)
    expect(css).toMatch(/@keyframes sweepIn \{\s*from \{\s*clip-path: inset\(0 0 0 100%\);/)
  })

  it('hands over to /search once; later letters only replace the URL (?q=)', () => {
    const fn = app.slice(app.indexOf('function openSearch('), app.indexOf('useEffect', app.indexOf('function openSearch(')))
    expect(fn).toMatch(/if \(searchOpen\) return;/)
    expect(fn.match(/router\.push\("\/search"\)/g)).toHaveLength(1)
    expect(fn).toMatch(/router\.replace\(typed \? `\/search\?q=\$\{encodeURIComponent\(typed\)\}` : "\/search"\)/)
    expect(app).toMatch(/router\.prefetch\("\/search"\)/)
    expect(app).toMatch(/setTimeout\(\(\) => setSearchOpen\(false\), LEAVE_TIMEOUT_MS\)/)
  })

  it('/search keeps its field in the header, same geometry, and starts from ?q=', () => {
    const header = search.slice(search.indexOf('className={styles.header}'), search.indexOf('<AppMenu'))
    expect(header).toMatch(/className=\{styles\.headerInput\}/)
    expect(header).toMatch(/autoFocus/)
    expect(searchCss).toMatch(/\.header \{[\s\S]*?padding: 11px;/)
    expect(searchCss).toMatch(/\.headerInput \{[\s\S]*?height: 40px;/)
    expect(search).toMatch(/useState\(\(\) => params\.get\("q"\) \?\? ""\)/)
    expect(search).toMatch(/sp\.has\("t"\) \|\| sp\.has\("p"\) \|\| sp\.has\("q"\)/)
  })
})
