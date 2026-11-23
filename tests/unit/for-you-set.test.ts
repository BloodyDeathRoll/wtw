import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { RecommendationResult } from '@/types/dna'

// v3 F1 (FOR-YOU.md DEC-1–3, #349): the 20 stay exactly as they are until Refresh, kept on the server per person and
// picker setting (for_you_sets, migration 0038). Flag off (FOR_YOU_V3), today's paged feed is untouched; a failed read
// of the 20 falls back to it.

const rec = (i: number) => ({
  tmdb_id: String(100 + i), type: 'movie', title: `t${i}`, composite_score: 1 - i / 100,
  explanation: `why ${i}`, is_stretch_pick: false, generated_at: '', fingerprint_version: 7,
}) as unknown as RecommendationResult
const batchOf = (from: number, n = 50) => Array.from({ length: n }, (_, i) => rec(from + i))

const db = vi.hoisted(() => ({
  stored: new Map<string, unknown[]>(),
  readFails: false,
  writeFails: false,
  upserts: [] as { content_type: string; recs: { tmdb_id: string }[] }[],
  served: [] as string[][],
  removed: [] as { tmdb_id: string; media_type: string }[],
  watchlist: [] as { rec_id: string }[],
  batch: [] as unknown[],
  // v3 F2: what the person did since the 20 were made, as the fingerprint has it.
  signals: [] as { tmdb_id: string; type: string; reaction: string }[],
  history: [] as Record<string, unknown>[],
}))

vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: (fn: () => unknown) => { void fn() },
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }))
vi.mock('@/lib/supabase/auth-user', () => ({ getAuthUser: async () => ({ id: 'u1' }) }))
vi.mock('@/lib/auth-guard', () => ({ logAuthFailure: () => {} }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: async () => null }))
vi.mock('@/modules/engine', () => ({ generateRecommendations: async () => [], getCachedRecommendations: async () => null, getWhyText: async () => null }))
vi.mock('@/modules/engine/enrichment/ensure-watch-providers', () => ({ ensureWatchProviders: async () => {} }))
vi.mock('@/modules/engine/pipeline/step8-cache', () => ({ getCachedRecommendations: async () => db.batch }))

// A tiny stand-in for the tables these routes read.
function query(table: string) {
  const filters: Record<string, unknown> = {}
  const q: Record<string, unknown> = {}
  q.select = () => q
  q.in = async () => ({ data: [], error: null })
  q.eq = (col: string, v: unknown) => { filters[col] = v; return q }
  q.single = async () => {
    if (table !== 'users') return { data: null, error: null }
    const dna = dnaAt(7)
    dna.signals = db.signals as never
    dna.learning_loop.recommendation_history = db.history as never
    return { data: { dna }, error: null }
  }
  q.maybeSingle = async () => {
    if (db.readFails) return { data: null, error: { message: 'boom' } }
    const recs = db.stored.get(String(filters.content_type))
    return { data: recs ? { recs } : null, error: null }
  }
  q.upsert = async (row: { content_type: string; recs: { tmdb_id: string }[] }) => {
    if (db.writeFails) return { error: { message: 'nope' } }
    db.upserts.push(row)
    db.stored.set(row.content_type, row.recs)
    return { error: null }
  }
  q.then = (res: (v: unknown) => void) => {
    if (table === 'removed_titles') return res({ data: db.removed, error: null })
    if (table === 'watchlist_entries') return res({ data: db.watchlist, error: null })
    if (table === 'for_you_sets') return res({ data: [...db.stored.values()].map((recs) => ({ recs })), error: null })
    return res({ data: [], error: null })
  }
  return q
}
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: query,
    rpc: async (_name: string, args: { p_keys: string[] }) => { db.served.push(args.p_keys); return { error: null } },
  }),
}))

const { createBlankDNA } = await import('@/modules/dna/blank-dna')
const dnaAt = (v: number) => { const d = createBlankDNA('u1'); d.metadata.taste_version = v; return d }
const { pickTheTwenty, SET_SIZE } = await import('@/lib/for-you-set')
const { GET } = await import('@/app/api/recommendations/generate/route')

const page = async (qs = '') => {
  const res = await GET(new Request(`http://t/api/recommendations/generate?type=movies${qs}`))
  const body = await res.json() as { recommendations: { id: string; match: number; reason: string }[]; has_more: boolean; set?: boolean; next_offset: number }
  return { status: res.status, ids: body.recommendations.map((r) => r.id), body }
}

beforeEach(() => {
  db.stored.clear(); db.readFails = false; db.writeFails = false
  db.upserts.length = 0; db.served.length = 0; db.removed.length = 0; db.watchlist.length = 0
  db.batch = batchOf(0)
  db.signals.length = 0; db.history.length = 0
})
afterEach(() => { vi.unstubAllEnvs() })

describe('pickTheTwenty', () => {
  const all = () => true
  it('takes the first 20 servable titles in the batch order', () => {
    const odd = (r: RecommendationResult) => Number(r.tmdb_id) % 2 === 1
    const set = pickTheTwenty(batchOf(0), odd)
    expect(set).toHaveLength(SET_SIZE)
    expect(set.map((r) => r.tmdb_id)).toEqual(Array.from({ length: 20 }, (_, i) => String(101 + 2 * i)))
  })

  it('leaves out the outgoing 20 (Refresh brings new picks)', () => {
    const previous = batchOf(0, 20)
    const set = pickTheTwenty(batchOf(0), all, previous)
    expect(set.map((r) => r.tmdb_id)).toEqual(batchOf(20, 20).map((r) => r.tmdb_id))
  })

  it('tops up with the outgoing ones when the batch is short, never past 20, never twice', () => {
    const previous = batchOf(0, 20)
    const set = pickTheTwenty([...batchOf(0, 25), rec(3)], all, previous)
    expect(set).toHaveLength(SET_SIZE)
    expect(set.slice(0, 5).map((r) => r.tmdb_id)).toEqual(['120', '121', '122', '123', '124'])
    expect(new Set(set.map((r) => r.tmdb_id)).size).toBe(SET_SIZE)
  })
})

describe('GET /api/recommendations/generate with FOR_YOU_V3 on', () => {
  beforeEach(() => { vi.stubEnv('FOR_YOU_V3', 'true') })

  it('makes the 20 the first time, keeps them, and serves all of them at once', async () => {
    const r = await page()
    expect(r.body.set).toBe(true)
    expect(r.body.has_more).toBe(false)
    expect(r.ids).toEqual(batchOf(0, 20).map((x) => `movie:${x.tmdb_id}`))
    expect(db.upserts).toHaveLength(1)
    expect(db.upserts[0].content_type).toBe('movies')
    expect(db.served).toEqual([r.ids])          // shown once, recorded once
  })

  it('serves the same 20 in the same order on the next visit, whatever the batch is now', async () => {
    const first = await page()
    db.batch = batchOf(200)                      // a rating refresh replaced the batch; the 6-hour cache moved on
    const again = await page('&offset=6&v=3')
    expect(again.ids).toEqual(first.ids)
    expect(again.body.recommendations.map((r) => r.reason)).toEqual(first.body.recommendations.map((r) => r.reason))
    expect(db.upserts).toHaveLength(1)           // not made again
    expect(db.served).toHaveLength(1)            // a visit isn't a new showing
  })

  it('a title on the Watchlist is never made into the 20, even without its saved mark in the fingerprint (#412)', async () => {
    db.watchlist.push({ rec_id: 'movie:102' }, { rec_id: 'movie:110' })
    const r = await page()
    expect(r.ids).toHaveLength(20)
    expect(r.ids).not.toContain('movie:102')
    expect(r.ids).not.toContain('movie:110')
    expect(r.ids[19]).toBe('movie:121')
  })

  it('a title hidden since drops out of the 20; the rest keep their places', async () => {
    const first = await page()
    db.removed.push({ tmdb_id: '103', media_type: 'movie' })
    const again = await page()
    expect(again.ids).toEqual(first.ids.filter((id) => id !== 'movie:103'))
  })

  // v3 F2 (FOR-YOU.md DEC-4, #350): what you did stays on the card until Refresh.
  it('a title rated or saved since stays in its place, the rated one carrying its rating (F2)', async () => {
    const first = await page()
    db.signals.push({ tmdb_id: '104', type: 'movie', reaction: 'loved' })
    db.history.push({ recommended: 'movie:107', tmdb_id: '107', type: 'movie', accepted: true, watched: false, rating: null })
    db.watchlist.push({ rec_id: 'movie:107' })
    const again = await page()
    expect(again.ids).toEqual(first.ids)
    const byId = Object.fromEntries((again.body.recommendations as { id: string; rated?: string }[]).map((r) => [r.id, r.rated]))
    expect(byId['movie:104']).toBe('loved')
    expect(byId['movie:107']).toBeUndefined()
    expect(byId['movie:105']).toBeUndefined()
  })

  it('a rating of a title of the other type with the same id lights nothing', async () => {
    await page()
    db.signals.push({ tmdb_id: '104', type: 'tv', reaction: 'disliked' })
    const again = await page()
    expect((again.body.recommendations as { id: string; rated?: string }[]).find((r) => r.id === 'movie:104')?.rated).toBeUndefined()
  })

  it('the next 20 leave out what was rated or saved (F2: until Refresh)', async () => {
    db.signals.push({ tmdb_id: '104', type: 'movie', reaction: 'liked' })
    db.watchlist.push({ rec_id: 'movie:107' })
    const { makeTheTwenty } = await import('@/lib/for-you-set')
    const previous = batchOf(0, 20)
    const r = await makeTheTwenty({
      userId: 'u1', dna: { ...dnaAt(7), signals: db.signals } as never, batch: batchOf(0, 22), removed: new Set(),
      contentType: 'movies', previous, source: 'refresh', mustKeep: true,
    })
    const ids = r.recommendations.map((c) => c.id)
    expect(ids).not.toContain('movie:104')
    expect(ids).not.toContain('movie:107')
  })

  it('a failed read of the 20 serves today\'s paged feed, not an error', async () => {
    db.readFails = true
    const r = await page()
    expect(r.status).toBe(200)
    expect(r.body.set).toBeUndefined()
    expect(r.ids).toHaveLength(6)
    expect(r.body.has_more).toBe(true)
  })

  it('a 20 that can\'t be kept is still shown', async () => {
    db.writeFails = true
    const r = await page()
    expect(r.body.set).toBe(true)
    expect(r.ids).toHaveLength(20)
  })
})

describe('GET /api/recommendations/generate with FOR_YOU_V3 off', () => {
  it('is today\'s paged feed: six at a time, nothing kept', async () => {
    db.stored.set('movies', batchOf(300, 20))   // even if a 20 were kept, it isn't read
    const r = await page()
    expect(r.body.set).toBeUndefined()
    expect(r.ids).toEqual(batchOf(0, 6).map((x) => `movie:${x.tmdb_id}`))
    expect(r.body.next_offset).toBe(6)
    expect(db.upserts).toHaveLength(0)
  })
})

describe('explain falls back to the 20', () => {
  it('finds a title of the 20 once its batch cache is gone (flag on), and not with the flag off', async () => {
    const { GET: explain } = await import('@/app/api/recommendations/explain/route')
    const { NextRequest } = await import('next/server')
    db.stored.set('movies', [{ ...rec(5), reason_payload: { kept: true } }])
    const ask = () => explain(new NextRequest('http://t/api/recommendations/explain?tmdb_id=105&type=movie'))
    expect((await ask()).status).toBe(404)
    vi.stubEnv('FOR_YOU_V3', 'true')
    const res = await ask()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ tmdb_id: '105', explanation: 'why 5', reason_payload: { kept: true } })
  })
})
