import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import type { Recommendation } from '@/types/recommendation'

// v3 Q1 (docs/plan/v3/SEARCH.md DEC-2, DEC-4, DEC-8): a title tapped in Search opens the same card page as the
// Watchlist and Seen, in that title's state for you, and a rating there lands through the feedback route.

vi.mock('@/lib/share', () => ({ shareTitle: vi.fn() }))

import SearchCard, { forgetMyRatings, myRatings } from '@/app/search/SearchCard'
import { markFor } from '@/app/search/SearchView'
import { addToWatchlist, getWatchlist, setWatchlistRating } from '@/lib/watchlist'
import { getAllPendingForTesting } from '@/lib/regret-queue'
import { announceHidden, RATED_EVENT } from '@/modules/session/recommendations/rate'

const user = { id: 'u1', email: null, name: 'Ada', avatarUrl: null }
const rec = (o: Partial<Recommendation> = {}): Recommendation => ({
  id: 'movie:77', title: 'Memento', type: 'movie', year: 2000, poster_url: null, meta: '1h 53m', rating: 8.2,
  match: 0, reason: 'A man with no short-term memory hunts his wife’s killer.', where: null, motif: 'dot',
  palette: ['#16242E', '#F5C9A6'], ...o,
})

type Call = { url: string; method: string; body: Record<string, unknown> | null }
let calls: Call[]
let ratings: { id: string; rating: string }[]
let hidden: { tmdb_id: string; media_type: string }[]
let line: string | null
let feedbackOk: boolean
let ratingsGate: Promise<void> | null
let feedbackGate: Promise<void> | null
let outcomes: boolean[]
let score: Record<string, unknown> | null

beforeEach(() => {
  window.localStorage.clear()
  forgetMyRatings()
  calls = []
  ratings = []
  hidden = []
  line = 'From Christopher Nolan, who made Interstellar, which you loved.'
  feedbackOk = true
  ratingsGate = null
  feedbackGate = null
  outcomes = []
  score = null
  window.sessionStorage.clear()
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null })
    if (url.includes('/ratings')) return (await ratingsGate, Response.json({ counts: {}, items: ratings, removed: hidden }))
    if (url.includes('why-lines')) return Response.json({ lines: line ? { 'movie:77': line } : {} })
    if (url.includes('/feedback')) return (await feedbackGate, (outcomes.length ? outcomes.shift() : feedbackOk) ? Response.json({ ok: true }) : new Response('no', { status: 500 }))
    if (url.includes('/score') && score) return Response.json(score)
    if (url.includes('/score') || url.includes('/explain')) return new Response('', { status: 404 })
    if (url.includes('/why')) return Response.json({ text: null })
    return Response.json({ entries: [] })
  }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const card = () => render(<SearchCard rec={rec()} user={user} />)
const feedback = () => calls.filter((c) => c.url.includes('/feedback'))

describe('a title from Search opens the card page', () => {
  it('unsaved: Add to Watchlist, Seen it?, no star; the why line built from facts replaces the synopsis', async () => {
    card()
    expect(screen.getByRole('button', { name: 'Add to Watchlist: Memento' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Loved it' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('button', { name: /Star Memento/ })).toBeNull()
    expect(await screen.findByText(/From Christopher Nolan/)).toBeInTheDocument()
  })

  it('a title we don\'t have keeps its synopsis', async () => {
    line = null
    card()
    await waitFor(() => expect(calls.some((c) => c.url.includes('why-lines'))).toBe(true))
    expect(await screen.findByText(/short-term memory/)).toBeInTheDocument()
  })

  it('a title you rated shows your reaction lit (from Seen)', async () => {
    ratings = [{ id: 'movie:77', rating: 'liked' }]
    card()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Liked it (tap to clear)' })).toHaveAttribute('aria-pressed', 'true'))
  })

  it('saved: Remove from Watchlist and the star', () => {
    addToWatchlist(rec())
    card()
    expect(screen.getByRole('button', { name: 'Remove from Watchlist: Memento' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Star Memento' })).toBeInTheDocument()
  })

  it('Loved lands through the feedback route (Seen and your taste), and the chip lights at once', async () => {
    card()
    fireEvent.click(screen.getByRole('button', { name: 'Loved it' }))
    expect(screen.getByRole('button', { name: 'Loved it (tap to clear)' })).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(feedback()).toHaveLength(1))
    expect(feedback()[0]).toMatchObject({ method: 'POST', body: { tmdb_id: '77', media_type: 'movie', action: 'watched', reaction: 'loved', content_type: 'all' } })
  })

  it('tapping the lit chip clears the rating (DELETE); a failed write puts the chip back', async () => {
    ratings = [{ id: 'movie:77', rating: 'loved' }]
    card()
    const lit = await screen.findByRole('button', { name: 'Loved it (tap to clear)' })
    fireEvent.click(lit)
    expect(screen.getByRole('button', { name: 'Loved it' })).toHaveAttribute('aria-pressed', 'false')
    await waitFor(() => expect(feedback()[0]).toMatchObject({ method: 'DELETE', body: { tmdb_id: '77', saved: false } }))

    feedbackOk = false
    fireEvent.click(screen.getByRole('button', { name: "Watched it, didn't like it" }))
    await waitFor(() => expect(feedback()).toHaveLength(2))
    expect(feedback()[1].body).toMatchObject({ action: 'skipped', reaction: 'disliked' })
    await waitFor(() => expect(screen.getByRole('button', { name: "Watched it, didn't like it" })).toHaveAttribute('aria-pressed', 'false'))
  })

  it('quick taps: a failed write never undoes a newer tap, and rolls back to what the server holds', async () => {
    card()
    outcomes = [false, true]
    fireEvent.click(screen.getByRole('button', { name: 'Loved it' }))
    fireEvent.click(screen.getByRole('button', { name: 'Liked it' }))
    await waitFor(() => expect(feedback()).toHaveLength(2))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Liked it (tap to clear)' })).toHaveAttribute('aria-pressed', 'true'))

    outcomes = [false, false]
    fireEvent.click(screen.getByRole('button', { name: "Watched it, didn't like it" }))
    fireEvent.click(screen.getByRole('button', { name: 'Loved it' }))
    await waitFor(() => expect(feedback()).toHaveLength(4))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Liked it (tap to clear)' })).toHaveAttribute('aria-pressed', 'true'))
  })

  it('a failed write rolls back to a rating made elsewhere meanwhile, and to Seen over a stale Watchlist tag', async () => {
    card()
    await waitFor(() => expect(calls.filter((c) => c.url.includes('/ratings'))).toHaveLength(1))
    window.dispatchEvent(new CustomEvent(RATED_EVENT, { detail: { id: 'movie:77', rating: 'liked' } }))
    feedbackOk = false
    fireEvent.click(screen.getByRole('button', { name: 'Loved it' }))
    await waitFor(() => expect(feedback()).toHaveLength(1))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Liked it (tap to clear)' })).toHaveAttribute('aria-pressed', 'true'))
    cleanup()

    forgetMyRatings()
    addToWatchlist(rec())
    setWatchlistRating('movie:77', 'disliked')
    ratings = [{ id: 'movie:77', rating: 'liked' }]
    card()
    await waitFor(() => expect(calls.filter((c) => c.url.includes('/ratings'))).toHaveLength(2))
    await new Promise((r) => setTimeout(r, 0))
    fireEvent.click(screen.getByRole('button', { name: 'Loved it' }))
    await waitFor(() => expect(feedback()).toHaveLength(2))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Liked it (tap to clear)' })).toHaveAttribute('aria-pressed', 'true'))
  })

  it('a late read of Seen never replaces a rating heard meanwhile, here or elsewhere', async () => {
    let open = () => {}
    ratingsGate = new Promise((r) => (open = r))
    ratings = [{ id: 'movie:77', rating: 'loved' }]
    card()
    window.dispatchEvent(new CustomEvent(RATED_EVENT, { detail: { id: 'movie:77', rating: 'liked' } }))
    open()
    await new Promise((r) => setTimeout(r, 0))
    feedbackOk = false
    fireEvent.click(screen.getByRole('button', { name: "Watched it, didn't like it" }))
    await waitFor(() => expect(feedback()).toHaveLength(1))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Liked it (tap to clear)' })).toHaveAttribute('aria-pressed', 'true'))
  })

  it('a late read of Seen never relights a chip cleared meanwhile, even with the clear still on its way', async () => {
    let open = () => {}
    ratingsGate = new Promise((r) => (open = r))
    addToWatchlist(rec())
    setWatchlistRating('movie:77', 'loved')
    ratings = [{ id: 'movie:77', rating: 'loved' }]
    let land = () => {}
    feedbackGate = new Promise((r) => (land = r))
    card()
    fireEvent.click(screen.getByRole('button', { name: 'Loved it (tap to clear)' }))
    await waitFor(() => expect(feedback()).toHaveLength(1))
    open() // Seen's list arrives with the clear still on its way
    await waitFor(() => expect(calls.filter((c) => c.url.includes('/ratings'))).toHaveLength(1))
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.getByRole('button', { name: 'Loved it' })).toHaveAttribute('aria-pressed', 'false')
    land()
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.getByRole('button', { name: 'Loved it' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('a rating made elsewhere (the feed, Seen) shows on the next card without reading the list again', async () => {
    card()
    await waitFor(() => expect(calls.filter((c) => c.url.includes('/ratings'))).toHaveLength(1))
    cleanup()
    window.dispatchEvent(new CustomEvent(RATED_EVENT, { detail: { id: 'movie:77', rating: 'disliked' } }))
    card()
    await waitFor(() => expect(screen.getByRole('button', { name: "Watched it, didn't like it (tap to clear)" })).toHaveAttribute('aria-pressed', 'true'))
    expect(calls.filter((c) => c.url.includes('/ratings'))).toHaveLength(1)
  })

  it('a saved title: Loved queues the 48-hour check-in once it lands; a failed one queues nothing', async () => {
    addToWatchlist(rec())
    feedbackOk = false
    card()
    fireEvent.click(screen.getByRole('button', { name: 'Loved it' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Loved it' })).toHaveAttribute('aria-pressed', 'false'))
    expect(getAllPendingForTesting()).toHaveLength(0)
    feedbackOk = true
    fireEvent.click(screen.getByRole('button', { name: 'Loved it' }))
    await waitFor(() => expect(getAllPendingForTesting().map((e) => e.tmdb_id)).toEqual(['77']))
  })

  it('Add to Watchlist saves it; rated first, it lands on the list with its reaction', async () => {
    card()
    fireEvent.click(screen.getByRole('button', { name: 'Liked it' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add to Watchlist: Memento' }))
    expect(getWatchlist().map((e) => [e.rec.id, e.rating])).toEqual([['movie:77', 'liked']])
    expect(screen.getByRole('button', { name: 'Remove from Watchlist: Memento' })).toBeInTheDocument()
  })
})

describe('your match (v3 Q5, SEARCH.md DEC-3)', () => {
  const scored = (match: number) => ({ scored: true, tmdb_id: '77', title: 'Memento', explanation: '', match,
    reason_payload: { crew_matches: [], lineage_connections: [], dimension_matches: [], soft_preferences_applied: [], external_ratings: [], is_stretch_pick: false, stretch_rationale: null, groq_rationale: '', negative_signals: [], taste: { bars: { taste: 0.9, crowd: 0.8, creators: 0.6 }, like: [] } } })
  const scoreCalls = () => calls.filter((c) => c.url.includes('/score')).length

  it('the card shows at once; the ring fills in with today\'s match when the engine answers, in one request', async () => {
    score = scored(0.87)
    card()
    expect(screen.getByRole('button', { name: 'Add to Watchlist: Memento' })).toBeInTheDocument()
    expect(await screen.findByRole('img', { name: '87% match' })).toBeInTheDocument()
    expect(scoreCalls()).toBe(1) // the ring and the breakdown under the card share it
  })

  it('a title the engine can\'t score (outside the catalogue, cold start) shows no ring', async () => {
    card()
    await waitFor(() => expect(scoreCalls()).toBeGreaterThan(0))
    expect(screen.queryByRole('img', { name: /% match/ })).toBeNull()
  })

  it('no older match stands in for today\'s: a saved card\'s match shows only if the engine gives it today', async () => {
    render(<SearchCard rec={rec({ match: 0.91 })} user={user} />)
    expect(screen.queryByRole('img', { name: /% match/ })).toBeNull()
    await waitFor(() => expect(scoreCalls()).toBeGreaterThan(0))
    expect(screen.queryByRole('img', { name: /% match/ })).toBeNull()
  })

  it('opened again this session: the ring is there at once, with no new request', async () => {
    score = scored(0.87)
    card()
    await screen.findByRole('img', { name: '87% match' })
    cleanup()
    const before = scoreCalls()
    card()
    expect(screen.getByRole('img', { name: '87% match' })).toBeInTheDocument()
    expect(scoreCalls()).toBe(before)
  })
})

describe('where a title stands with you (SEARCH_V3, SEARCH.md DEC-5)', () => {
  it('your rating first, then saved, then hidden from For you; no mark otherwise', () => {
    expect(markFor('loved', true)).toBe('❤️ Loved')
    expect(markFor('liked', false)).toBe('👍 Liked')
    expect(markFor('disliked', false)).toBe('👎 Disliked')
    expect(markFor('removed', true)).toBe('In your Watchlist')
    expect(markFor(undefined, true)).toBe('In your Watchlist')
    expect(markFor('removed', false)).toBe('Hidden from For you')
    expect(markFor(undefined, false)).toBeUndefined()
  })

  it('Seen\'s list carries what you hid, and the card lights no chip for it', async () => {
    hidden = [{ tmdb_id: '77', media_type: 'movie' }]
    ratings = [{ id: 'tv:9', rating: 'liked' }]
    expect(await myRatings()).toEqual({ 'movie:77': 'removed', 'tv:9': 'liked' })
    card()
    await new Promise((r) => setTimeout(r, 0))
    for (const name of ['Loved it', 'Liked it', "Watched it, didn't like it"])
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'false')
  })

  it('a title hidden or restored anywhere updates Seen\'s list; a rating outranks hidden', async () => {
    ratings = [{ id: 'tv:9', rating: 'liked' }]
    await myRatings()
    announceHidden('movie:5', true)
    announceHidden('tv:9', true)
    expect(await myRatings()).toEqual({ 'movie:5': 'removed', 'tv:9': 'liked' })
    announceHidden('movie:5', false)
    announceHidden('tv:9', false)
    expect(await myRatings()).toEqual({ 'tv:9': 'liked' })
  })

  // Source-level: both views need a whole page around them.
  it('For you\'s Remove and Seen\'s Restore announce it once the write lands', () => {
    const feed = readFileSync('src/modules/session/recommendations/RecommendationsView.tsx', 'utf8')
    const seen = readFileSync('src/modules/session/ratings/RatingsView.tsx', 'utf8')
    expect(feed).toMatch(/if \(!res\.ok\) \{[\s\S]{0,200}\} else \{\s*announceHidden\(`\$\{rec\.type\}:\$\{tmdb_id\}`, true\);/)
    expect(seen).toMatch(/if \(!res\.ok\) throw new Error\(String\(res\.status\)\);\s*announceHidden\(`\$\{rem\.media_type\}:\$\{rem\.tmdb_id\}`, false\);/)
  })
})

// Source-level: SearchView needs the router and a page around it.
describe('SearchView under SEARCH_V3', () => {
  const view = readFileSync('src/app/search/SearchView.tsx', 'utf8')
  it('opens SearchCard for every title, and calls the own-titles group "In Seen" (DEC-8)', () => {
    expect(view).toContain('{card && v3 && (')
    expect(view).toContain('<SearchCard key={card.id} rec={card} user={user} />')
    expect(view).toContain('v3 ? "In Seen" : "In your ratings"')
  })
  it('marks every title row: the results, your own group and a person\'s titles (DEC-5)', () => {
    expect(view.match(/<TitleRow[^>]*\bmark=\{markOf\(/g)).toHaveLength(3)
  })
  it('the mark follows the year on the second line, in white; the third line is the actors or the character alone (Eran, #365)', () => {
    expect(view).toMatch(/\{h\.year \?\? ""\}[\s\S]*?series[\s\S]*?<span className=\{styles\.mark\}>\{mark\}<\/span>[\s\S]*?<\/small>\s*<small className=\{styles\.cast\}>\{line \|\| "\\u00a0"\}<\/small>/)
    expect(readFileSync('src/app/search/search.module.css', 'utf8')).toMatch(/\.row \.mark \{[^}]*color: #fff;/)
  })
})
