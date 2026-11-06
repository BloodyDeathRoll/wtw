// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// The two routes behind "Why it's a match" (2026-11-06): the written text for
// the sheet, and fresh fact-built card lines for the Watchlist.

const whyForTitle = vi.fn()
const cardLinesForTitles = vi.fn()
let signedIn = true
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }))
vi.mock('@/lib/supabase/auth-user', () => ({ getAuthUser: async () => (signedIn ? { id: 'u1' } : null) }))
vi.mock('@/lib/auth-guard', () => ({ logAuthFailure: () => {} }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: async () => null }))
vi.mock('@/modules/engine', () => ({
  whyForTitle: (...a: unknown[]) => whyForTitle(...a),
  cardLinesForTitles: (...a: unknown[]) => cardLinesForTitles(...a),
}))

const why = await import('@/app/api/recommendations/why/route')
const lines = await import('@/app/api/recommendations/why-lines/route')
const { NextRequest } = await import('next/server')

beforeEach(() => { signedIn = true; whyForTitle.mockReset(); cardLinesForTitles.mockReset() })

describe('GET /api/recommendations/why', () => {
  const get = (q: string) => why.GET(new NextRequest(`http://x/api/recommendations/why?${q}`))

  it('returns the written text for a title', async () => {
    whyForTitle.mockResolvedValueOnce({ text: 'Ruby, the only hearing member…', source: 'ai' })
    const res = await get('tmdb_id=776503&type=movie')
    expect(await res.json()).toEqual({ text: 'Ruby, the only hearing member…', source: 'ai' })
    expect(whyForTitle).toHaveBeenCalledWith('u1', { type: 'movie', tmdb_id: '776503' })
  })

  it('needs a signed-in user and a well-formed title', async () => {
    expect((await get('tmdb_id=1&type=movie&x=1').then(r => r.status))).toBe(200)
    expect((await get('tmdb_id=abc&type=movie')).status).toBe(400)
    expect((await get('tmdb_id=1&type=book')).status).toBe(400)
    signedIn = false
    expect((await get('tmdb_id=1&type=movie')).status).toBe(401)
  })

  it('answers "nothing better" rather than failing when the engine throws', async () => {
    whyForTitle.mockRejectedValueOnce(new Error('db down'))
    expect(await (await get('tmdb_id=1&type=tv')).json()).toEqual({ text: null, source: null })
  })
})

describe('POST /api/recommendations/why-lines', () => {
  const post = (body: unknown) => lines.POST(new NextRequest('http://x/api/recommendations/why-lines', {
    method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
  }))

  it('returns fresh lines keyed by id', async () => {
    cardLinesForTitles.mockResolvedValueOnce({ 'movie:1': 'A funny and warm heist film.' })
    const res = await post({ ids: ['movie:1', 'movie:1', 'tv:2'] })
    expect(await res.json()).toEqual({ lines: { 'movie:1': 'A funny and warm heist film.' } })
    expect(cardLinesForTitles).toHaveBeenCalledWith('u1', [{ type: 'movie', tmdb_id: '1' }, { type: 'tv', tmdb_id: '2' }])
  })

  it('passes "keep the saved lines" through for a brand-new user', async () => {
    cardLinesForTitles.mockResolvedValueOnce(null)
    expect(await (await post({ ids: ['movie:1'] })).json()).toEqual({ lines: null })
  })

  it('refuses malformed or oversized lists', async () => {
    expect((await post({ ids: ['movie:1; drop'] })).status).toBe(400)
    expect((await post({ ids: Array.from({ length: 201 }, (_, i) => `movie:${i}`) })).status).toBe(400)
    expect((await post({})).status).toBe(400)
  })
})
