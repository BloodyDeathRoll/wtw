import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { searchUrl } from '@/app/components/HeaderSearch'

// Search from every header (2026-11-07): the icon beside the menu sweeps
// /search's field into the header row and hands over to /search, whose field
// sits in its header. Ratings and Watchlist list their own titles first.
// Source-level checks, like find-more-sends-more.test.ts — these views have no render harness.

const hs = readFileSync('src/app/components/HeaderSearch.tsx', 'utf8')
const hsCss = readFileSync('src/app/components/HeaderSearch.module.css', 'utf8')
const app = readFileSync('src/modules/session/components/WTWApp.tsx', 'utf8')
const recs = readFileSync('src/modules/session/recommendations/RecommendationsView.tsx', 'utf8')
const ratings = readFileSync('src/modules/session/ratings/RatingsView.tsx', 'utf8')
const play = readFileSync('src/app/play/components/ui.tsx', 'utf8')
const dna = readFileSync('src/app/profile/dna/DnaHeader.tsx', 'utf8')
const search = readFileSync('src/app/search/SearchView.tsx', 'utf8')
const searchCss = readFileSync('src/app/search/search.module.css', 'utf8')

describe('searchUrl', () => {
  it('carries the screen’s group and what was typed', () => {
    expect(searchUrl(undefined)).toBe('/search')
    expect(searchUrl('ratings')).toBe('/search?in=ratings')
    expect(searchUrl('watchlist', 'the wire')).toBe('/search?in=watchlist&q=the%20wire')
    expect(searchUrl(undefined, 'x')).toBe('/search?q=x')
  })
})

describe('header search', () => {
  it('is in every header: home (in place of share), Picks/Watchlist, Ratings, Games, Taste DNA', () => {
    expect(app).not.toMatch(/shareApp|ShareIcon|I\.share\b/)
    expect(app).toMatch(/<HeaderSearch btnClass=\{styles\.iconbtn\} padLeft=\{11\} \/>/)
    expect(recs).toMatch(/<HeaderSearch btnClass=\{styles\.headerBtn\} scope=\{mode === "watchlist" \? "watchlist" : undefined\} \/>/)
    expect(ratings).toMatch(/<HeaderSearch btnClass=\{styles\.headerBtn\} scope="ratings" \/>/)
    expect(play).toMatch(/<HeaderSearch btnClass="tb-back" padLeft=\{11\} \/>/)
    expect(dna).toMatch(/<HeaderSearch btnClass=\{styles\.headerIconBtn\} \/>/)
    // Each host row is marked so the overlay can measure it.
    for (const src of [app, recs, ratings, play, dna]) expect(src).toMatch(/data-header-row/)
  })

  it('the field sweeps in over the row, focused as it mounts, without positioning any header', () => {
    expect(hs).toMatch(/closest<HTMLElement>\("\[data-header-row\]"\)/)
    expect(hs).toMatch(/className=\{sx\.headerInput\}[\s\S]*?autoFocus/)
    expect(hsCss).toMatch(/\.overlay \{[\s\S]*?position: fixed;[\s\S]*?animation: sweepIn/)
    expect(hsCss).toMatch(/@keyframes sweepIn \{\s*from \{\s*clip-path: inset\(0 0 0 100%\);/)
  })

  it('hands over to /search once; later letters only replace the URL; a dead route gives the header back', () => {
    const open = hs.slice(hs.indexOf('function open()'), hs.indexOf('return (', hs.indexOf('function open()')))
    expect(open).toMatch(/if \(box \|\| !btn\) return;/)
    expect(open.match(/router\.push\(/g)).toHaveLength(1)
    expect(hs).toMatch(/onChange=\{\(e\) => router\.replace\(searchUrl\(scope, e\.target\.value\)\)\}/)
    expect(hs).toMatch(/router\.prefetch\("\/search"\)/)
    expect(hs).toMatch(/setTimeout\(\(\) => setBox\(null\), LEAVE_TIMEOUT_MS\)/)
  })

  it('/search: field in the header, ?q= start, and the screen’s own group first', () => {
    const header = search.slice(search.indexOf('className={styles.header}'), search.indexOf('<AppMenu'))
    expect(header).toMatch(/className=\{styles\.headerInput\}/)
    expect(header).toMatch(/autoFocus/)
    expect(searchCss).toMatch(/\.header \{[\s\S]*?padding: 11px;/)
    expect(search).toMatch(/useState\(\(\) => params\.get\("q"\) \?\? ""\)/)
    // The group: watchlist from the local list (card already in hand), ratings from the API.
    expect(search).toMatch(/inParam === "ratings" \|\| inParam === "watchlist"/)
    expect(search).toMatch(/getWatchlist\(\)\.map/)
    expect(search).toMatch(/fetch\("\/api\/recommendations\/ratings"\)/)
    // Listed first, then TMDB's results without the ones already shown.
    expect(search).toMatch(/\{showMine && \([\s\S]*?In your watchlist[\s\S]*?\{showHits && <p className=\{styles\.groupLabel\}>All titles<\/p>\}/)
    expect(search).toMatch(/const shown = hits\.filter\(\(h\) => !mineKeys\.has\(keyOf\(h\)\)\)/)
    // Card and person URLs keep ?in= so Back and reload stay in the group.
    expect(search).toMatch(/pushState\(null, "", url\(/)
    expect(search).not.toMatch(/pushState\(null, "", `\/search/)
  })
})
