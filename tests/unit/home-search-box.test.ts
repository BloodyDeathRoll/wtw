import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { SEARCH_FROM, safeFrom, searchUrl } from '@/app/search/url'

// Search from every header (2026-11-07): the icon beside the menu sweeps the
// search screen in over the host screen, which stays mounted under it — only
// the URL becomes /search (pushState), so the field focused in the tap never
// re-mounts and the keyboard stays up (a route swap dropped it and brought it
// back). Ratings and Watchlist list their own titles first, and Back pops
// back to the screen the search was opened from. The menu's own Search entry
// is gone.
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
  it('carries the screen’s group and where Back returns after a reload', () => {
    expect(searchUrl(undefined)).toBe('/search')
    expect(searchUrl('ratings', 'ratings')).toBe('/search?in=ratings&from=ratings')
    expect(searchUrl('watchlist', 'watchlist')).toBe('/search?in=watchlist&from=watchlist')
    expect(searchUrl(undefined, '/play')).toBe('/search?from=%2Fplay')
  })
})

describe('safeFrom', () => {
  it('accepts only the known screens — never an off-site or unknown target', () => {
    for (const ok of ['recommendations', 'watchlist', 'learning', 'ratings', '/play', '/profile/dna']) expect(safeFrom(ok)).toBe(ok)
    for (const bad of ['//evil.example', '/\\evil.example', 'https://evil.example', '/login', 'intro', '', null, undefined])
      expect(safeFrom(bad)).toBeNull()
  })

  it('every stage it allows is one the home deep-links (DEEP_LINK_STAGES)', () => {
    const list = /const DEEP_LINK_STAGES[^=]*=\s*\[([^\]]*)\]/.exec(app)![1]
    const stages = [...list.matchAll(/"([a-z]+)"/g)].map((m) => m[1])
    for (const f of SEARCH_FROM) if (!f.startsWith('/')) expect(stages).toContain(f)
  })
})

describe('header search', () => {
  it('is in every header, in place of share at home; the menu’s Search entry is gone', () => {
    expect(app).not.toMatch(/shareApp|ShareIcon|I\.share\b/)
    expect(app).toMatch(/<HeaderSearch btnClass=\{styles\.iconbtn\} user=\{user\} menu=\{menu\} \/>\s*\{menu\}/)
    expect(recs).toMatch(/\{user && \(\s*<HeaderSearch\s*btnClass=\{styles\.headerBtn\}\s*user=\{user\}\s*menu=\{headerRight\}\s*scope=\{mode === "watchlist" \? "watchlist" : undefined\}\s*from=\{mode\}\s*\/>/)
    expect(ratings).toMatch(/\{user && <HeaderSearch btnClass=\{styles\.headerBtn\} user=\{user\} menu=\{headerRight\} scope="ratings" from="ratings" \/>\}/)
    expect(play).toMatch(/<HeaderSearch btnClass="tb-back" user=\{ctl\.user\} menu=\{menu\} from="\/play" \/>\s*\{menu\}/)
    expect(dna).toMatch(/<HeaderSearch btnClass=\{styles\.headerIconBtn\} user=\{user\} menu=\{menu\} from="\/profile\/dna" \/>\s*\{menu\}/)
    // The home passes the user down so the two views can show the icon.
    expect(app).toMatch(/<RatingsView onBack=[\s\S]*?headerRight=\{appMenu\} user=\{user\} \/>/)
    expect(app.match(/<RecommendationsView[\s\S]*?\/>/g)!.every((v) => v.includes('user={user}'))).toBe(true)
    expect(menu).not.toMatch(/"search"|onSearch|goingToSearch|<span>Search<\/span>/)
    expect(play).not.toMatch(/'search'/)
  })

  it('opens /search in place: pushState, the view in a full-screen sweep, no navigation, and Back pops it', () => {
    expect(hs).toMatch(/window\.history\.pushState\(null, "", searchUrl\(scope, from\)\)/)
    expect(hs).not.toMatch(/router\.|useRouter|usePathname/)
    expect(hs).toMatch(/createPortal\(\s*<div className=\{styles\.overlay\}>\s*<AppShell>\s*<SearchView user=\{user\} menu=\{hostMenu\} \/>/)
    expect(hs).toMatch(/addEventListener\("popstate", onPop\)/)
    expect(hsCss).toMatch(/\.overlay \{[\s\S]*?position: fixed;\s*inset: 0;[\s\S]*?animation: sweepIn/)
    expect(hsCss).toMatch(/@keyframes sweepIn \{\s*from \{\s*clip-path: inset\(0 0 0 100%\);/)
    // No header is positioned for it (the menu drawer's containing block).
    for (const src of [app, recs, ratings, play, dna]) expect(src).not.toMatch(/data-header-row/)
  })

  it('/search: field in the header, focused as it mounts; the screen’s own group first; Back pops in place, else to ?from=', () => {
    const header = search.slice(search.indexOf('className={styles.header}'), search.indexOf('<AppMenu'))
    expect(header).toMatch(/className=\{styles\.headerInput\}/)
    expect(header).toMatch(/autoFocus/)
    expect(searchCss).toMatch(/\.header \{[\s\S]*?padding: 11px;/)
    expect(search).not.toMatch(/get\("q"\)/)
    expect(search).toMatch(/\{menu \?\? \(\s*<AppMenu/)
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
    // Back: in place, pop to the host screen; after a reload, a known home stage or route only (safeFrom), by replace.
    expect(search).toMatch(/if \(openKey \|\| openPerson \|\| inPlace\) window\.history\.back\(\);/)
    expect(search).toMatch(/const from = safeFrom\(params\.get\("from"\)\);/)
    expect(search).toMatch(/const base = searchUrl\(scope \?\? undefined, from \?\? undefined\);/)
    expect(search).toMatch(/router\.replace\(from\.startsWith\("\/"\) \? from : `\/\?stage=\$\{encodeURIComponent\(from\)\}`\)/)
  })
})
