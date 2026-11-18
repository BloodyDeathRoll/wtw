// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// v3 Q4: with SEARCH_V3 off, /api/search is exactly today's TMDB search; on,
// the catalogue joins, and either side failing serves the other's list.

const io = vi.hoisted(() => ({ v3: false, tmdbFail: false, catFail: false, tmdbCalls: [] as unknown[] }))
vi.mock('@/lib/flags', async (orig) => ({ ...(await orig<typeof import('@/lib/flags')>()), searchV3Enabled: () => io.v3 }))
vi.mock('@/lib/auth-guard', () => ({ logAuthFailure: () => {} }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getClaims: async () => ({ data: { claims: { sub: 'u1' } }, error: null }) } }) }))
vi.mock('@/lib/tmdb', async (orig) => ({
  ...(await orig<typeof import('@/lib/tmdb')>()),
  searchTitles: async (...a: unknown[]) => {
    io.tmdbCalls.push(a)
    if (io.tmdbFail) throw new Error('tmdb down')
    return [{ tmdb_id: '100', type: 'movie', title: 'S.L. Film', year: 2001, poster_path: null }]
  },
}))
vi.mock('@/lib/search-catalogue', async (orig) => ({
  ...(await orig<typeof import('@/lib/search-catalogue')>()),
  catalogueCandidates: async () => {
    if (io.catFail) throw new Error('db down')
    return [{ tmdb_id: '8', type: 'tv', title: 'Slow Horses', release_year: 2022, poster_path: '/sh.jpg', tmdb_vote_count: 880, first_word: true, similarity: null }]
  },
  voteQuantiles: async () => ({}),
}))

const { GET } = await import('@/app/api/search/route')
const get = async (q: string) => { const url = `http://x/api/search?q=${encodeURIComponent(q)}`; return (await GET(Object.assign(new Request(url), { nextUrl: new URL(url) }) as never)).json() }
const titles = (r: { results: { title?: string }[] }) => r.results.map(h => h.title)

beforeEach(() => {
  io.v3 = false; io.tmdbFail = false; io.catFail = false; io.tmdbCalls = []
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('GET /api/search with SEARCH_V3', () => {
  it('off: today\'s TMDB search, exactly (six, no votes asked for)', async () => {
    expect(titles(await get('sl'))).toEqual(['S.L. Film'])
    expect(io.tmdbCalls).toEqual([['sl', 6, { people: true }]])
  })
  it('on: the catalogue joins, first-word matches first', async () => {
    io.v3 = true
    expect(titles(await get('sl'))).toEqual(['Slow Horses', 'S.L. Film'])
  })
  it('on, catalogue down: TMDB\'s list', async () => {
    io.v3 = true; io.catFail = true
    expect(titles(await get('sl'))).toEqual(['S.L. Film'])
  })
  it('on, TMDB down: the catalogue\'s list', async () => {
    io.v3 = true; io.tmdbFail = true
    expect(titles(await get('sl'))).toEqual(['Slow Horses'])
  })
  it('on, both down: the same error as today', async () => {
    io.v3 = true; io.tmdbFail = true; io.catFail = true
    expect(await get('sl')).toEqual({ error: 'Search is unavailable' })
  })
  it('one letter: nothing, flag on or off', async () => {
    io.v3 = true
    expect(await get('s')).toEqual({ results: [] })
  })
})
