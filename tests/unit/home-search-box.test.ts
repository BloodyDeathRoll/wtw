import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { safeFrom, searchUrl } from '@/app/components/HeaderSearch'

// Search from every header (2026-11-07): the icon beside the menu sweeps
// /search's field into the header row and hands over to /search, whose field
// sits in its header. Ratings and Watchlist list their own titles first, and
// Back returns to the screen the search was opened from. The menu's own
// Search entry is gone.
// Source-level checks, like find-more-sends-more.test.ts — these views have no render harness.

const hs = readFileSync('src/app/components/HeaderSearch.tsx', 'utf8')
const hsCss = readFileSync('src/app/components/HeaderSearch.module.css', 'utf8')
const app = readFileSync('src/modules/session/components/WTWApp.tsx', 'utf8')
const menu = readFileSync('src/modules/session/components/AppMenu.tsx', 'utf8')
const recs = readFileSync('src/modules/session/recommendations/RecommendationsView.tsx', 'utf8')
const ratings = readFileSync('src/modules/session/ratings/RatingsView.tsx', 'utf8')
const play = readFileSync('src/app/play/components/ui.tsx', 'utf8')
const dna = readFileSync('src/app/profile/dna/DnaHeader.tsx', 'utf8')
const search = readFileSync('src/app/search/SearchView.tsx', 'utf8')
const searchCss = readFileSync('src/app/search/search.module.css', 'utf8')

describe('searchUrl', () => {
  it('carries the screen’s group, where Back returns, and what was typed', () => {
    expect(searchUrl(undefined)).toBe('/search')
    expect(searchUrl('ratings', '', 'ratings')).toBe('/search?in=ratings&from=ratings')
    expect(searchUrl('watchlist', 'the wire', 'watchlist')).toBe('/search?in=watchlist&from=watchlist&q=the%20wire')
    expect(searchUrl(undefined, 'x', '/play')).toBe('/search?from=%2Fplay&q=x')
  })
})

describe('safeFrom', () => {
  it('accepts only the known screens — never an off-site or unknown target', () => {
    for (const ok of ['recommendations', 'watchlist', 'learning', 'ratings', '/play', '/profile/dna']) expect(safeFrom(ok)).toBe(ok)
    for (const bad of ['//evil.example', '/\\evil.example', 'https://evil.example', '/login', 'intro', '', null, undefined])
      expect(safeFrom(bad)).toBeNull()
  })
})

describe('header search', () => {
  it('is in every header, in place of share at home; the menu’s Search entry is gone', () => {
    expect(app).not.toMatch(/shareApp|ShareIcon|I\.share\b/)
    expect(app).toMatch(/<HeaderSearch btnClass=\{styles\.iconbtn\} padLeft=\{11\} \/>/)
    expect(recs).toMatch(/\{headerRight && \(\s*<HeaderSearch btnClass=\{styles\.headerBtn\} scope=\{mode === "watchlist" \? "watchlist" : undefined\} from=\{mode\} \/>/)
    expect(ratings).toMatch(/\{headerRight && <HeaderSearch btnClass=\{styles\.headerBtn\} scope="ratings" from="ratings" \/>\}/)
    expect(play).toMatch(/<HeaderSearch btnClass="tb-back" padLeft=\{11\} from="\/play" \/>/)
    expect(dna).toMatch(/<HeaderSearch btnClass=\{styles\.headerIconBtn\} from="\/profile\/dna" \/>/)
    // Each host row is marked so the overlay can measure it.
    for (const src of [app, recs, ratings, play, dna]) expect(src).toMatch(/data-header-row/)
    expect(menu).not.toMatch(/"search"|onSearch|goingToSearch|<span>Search<\/span>/)
    expect(play).not.toMatch(/'search'/)
  })

  it('the field sweeps in over the row, focused as it mounts, without positioning any header', () => {
    expect(hs).toMatch(/closest<HTMLElement>\("\[data-header-row\]"\)/)
    expect(hs).toMatch(/className=\{sx\.headerInput\}[\s\S]*?autoFocus/)
    expect(hsCss).toMatch(/\.overlay \{[\s\S]*?position: fixed;[\s\S]*?animation: sweepIn/)
    expect(hsCss).toMatch(/@keyframes sweepIn \{\s*from \{\s*clip-path: inset\(0 0 0 100%\);/)
  })

  it('pushes /search once the sweep has played, with what was typed; Back during the sweep cancels it', () => {
    expect(hs).toMatch(/setTimeout\(\(\) => \{\s*pushed\.current = true;\s*router\.push\(searchUrl\(scope, typedRef\.current, from\)\);\s*\}, SWEEP_MS\)/)
    expect(hs.match(/router\.push\(/g)).toHaveLength(1)
    expect(hs).toMatch(/if \(pushed\.current\) router\.replace\(searchUrl\(scope, v, from\)\)/)
    expect(hs).toMatch(/function back\(\) \{\s*if \(pushed\.current\) return;\s*setBox\(null\);/)
    expect(hs).not.toMatch(/router\.back\(/)
    expect(hs).toMatch(/router\.prefetch\("\/search"\)/)
    expect(hs).toMatch(/setTimeout\(\(\) => setBox\(null\), LEAVE_TIMEOUT_MS\)/)
  })

  it('/search: field in the header, ?q= until typed into, the screen’s own group first, Back to ?from=', () => {
    const header = search.slice(search.indexOf('className={styles.header}'), search.indexOf('<AppMenu'))
    expect(header).toMatch(/className=\{styles\.headerInput\}/)
    expect(header).toMatch(/autoFocus/)
    expect(searchCss).toMatch(/\.header \{[\s\S]*?padding: 11px;/)
    expect(search).toMatch(/const q = typedHere \?\? params\.get\("q"\) \?\? "";/)
    expect(search).not.toMatch(/sp\.has\("q"\)/)
    // The group: watchlist from the local list (card already in hand), ratings from the API.
    expect(search).toMatch(/inParam === "ratings" \|\| inParam === "watchlist"/)
    expect(search).toMatch(/getWatchlist\(\)\.map/)
    expect(search).toMatch(/fetch\("\/api\/recommendations\/ratings"\)/)
    // Listed first, then TMDB's results without the ones already shown.
    expect(search).toMatch(/\{showMine && \([\s\S]*?In your watchlist[\s\S]*?\{showHits && <p className=\{styles\.groupLabel\}>All titles<\/p>\}/)
    expect(search).toMatch(/const shown = hits\.filter\(\(h\) => !mineKeys\.has\(keyOf\(h\)\)\)/)
    // Card and person URLs keep ?in= and ?from= so Back and reload stay in the group.
    expect(search).toMatch(/pushState\(null, "", url\(/)
    expect(search).not.toMatch(/pushState\(null, "", `\/search/)
    // Back: a known home stage or route only (safeFrom), by replace; from survives the reload strip.
    expect(search).toMatch(/const from = safeFrom\(params\.get\("from"\)\);/)
    expect(search).toMatch(/const base = searchUrl\(scope \?\? undefined, "", from \?\? undefined\);/)
    expect(search).toMatch(/router\.replace\(from\.startsWith\("\/"\) \? from : `\/\?stage=\$\{encodeURIComponent\(from\)\}`\)/)
  })
})
