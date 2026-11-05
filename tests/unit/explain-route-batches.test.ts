// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// "Why it's a match" reads the title's breakdown from the saved batch. Movies,
// Series and Both are saved separately; until 2026-11-05 the route never
// looked in the Both batch, so with the picker on Both every title said the
// breakdown wasn't ready.

type Rec = { tmdb_id: string; type: 'movie' | 'tv'; title: string; explanation: string; reason_payload: object; is_stretch_pick: boolean }
const rec = (tmdb_id: string, type: 'movie' | 'tv', title: string): Rec =>
  ({ tmdb_id, type, title, explanation: `why ${title}`, reason_payload: {}, is_stretch_pick: false })

let batches: Record<string, Rec[] | null> = {}
const getCachedRecommendations = vi.fn(async (_u: string, _v: number, contentType: string) => batches[contentType] ?? null)

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getClaims: async () => ({ data: { claims: { sub: 'u1' } }, error: null }) } }),
}))
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { dna: { metadata: { taste_version: 7 } } } }) }) }) }),
  }),
}))
vi.mock('@/lib/auth-guard', () => ({ logAuthFailure: () => {} }))
let sheet: Record<string, string> = {}
const getSheetExplanation = vi.fn(async (_u: string, _v: number, contentType: string, key: string) => sheet[`${contentType}|${key}`] ?? null)
vi.mock('@/modules/engine', () => ({ getCachedRecommendations, getSheetExplanation }))

const { GET } = await import('@/app/api/recommendations/explain/route')
const { NextRequest } = await import('next/server')
const get = (q: string) => GET(new NextRequest(`http://x/api/recommendations/explain?${q}`))

describe('explain route: which saved batch it reads', () => {
  beforeEach(() => { batches = {}; sheet = {}; getCachedRecommendations.mockClear() })

  it('finds a title in the Both batch', async () => {
    batches = { all: [rec('7326', 'movie', 'Juno'), rec('1396', 'tv', 'Breaking Bad')] }
    const res = await get('tmdb_id=7326&type=movie')
    expect(res.status).toBe(200)
    expect((await res.json()).title).toBe('Juno')
  })

  it("prefers the title's own batch, then Both", async () => {
    batches = { movies: [rec('7326', 'movie', 'Juno (movies batch)')], all: [rec('7326', 'movie', 'Juno (both batch)')] }
    expect((await (await get('tmdb_id=7326&type=movie')).json()).title).toBe('Juno (movies batch)')
  })

  it('keeps movie and series apart when their numbers collide, in Both too', async () => {
    batches = { all: [rec('1396', 'movie', 'A film'), rec('1396', 'tv', 'Breaking Bad')] }
    expect((await (await get('tmdb_id=1396&type=tv')).json()).title).toBe('Breaking Bad')
  })

  it('without a type, checks Movies, Series and Both', async () => {
    batches = { all: [rec('7326', 'movie', 'Juno')] }
    const res = await get('tmdb_id=7326')
    expect(res.status).toBe(200)
    expect(getCachedRecommendations.mock.calls.map(c => c[2])).toEqual(['movies', 'series', 'all'])
  })

  it('404s when nothing is saved, or the title is in no batch', async () => {
    expect((await get('tmdb_id=7326&type=movie')).status).toBe(404)
    batches = { all: [rec('1', 'movie', 'Other')] }
    expect((await get('tmdb_id=7326&type=movie')).status).toBe(404)
  })
})

// Since 2026-11-05 the card keeps its short line and the sheet's AI paragraph
// is stored beside the batch, for the batch the title was found in.
describe('explain route: the sheet text', () => {
  beforeEach(() => { batches = {}; sheet = {} })

  it("shows the sheet's own paragraph when it has landed", async () => {
    batches = { all: [rec('7326', 'movie', 'Juno')] }
    sheet = { 'all|movie:7326': 'A longer paragraph for the sheet.' }
    expect((await (await get('tmdb_id=7326&type=movie')).json()).explanation).toBe('A longer paragraph for the sheet.')
  })

  it('shows the card line until then, or if the read fails', async () => {
    batches = { movies: [rec('7326', 'movie', 'Juno')] }
    sheet = { 'all|movie:7326': 'from the wrong batch' }
    expect((await (await get('tmdb_id=7326&type=movie')).json()).explanation).toBe('why Juno')
    getSheetExplanation.mockRejectedValueOnce(new Error('redis down'))
    expect((await (await get('tmdb_id=7326&type=movie')).json()).explanation).toBe('why Juno')
  })
})
