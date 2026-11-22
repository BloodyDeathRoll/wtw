// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest'

// GET /api/recommendations/ratings reads past PostgREST's 1,000-row answer (#359): the ratings a page at a time, and
// the titles in chunks per type, so a heavy account loses neither old ratings nor posters.

const CAP = 1000
const db = vi.hoisted(() => ({
  feedback: [] as { recommendation_id: string; title: string | null; rating: string; created_at: string }[],
  removed: [] as { tmdb_id: string; media_type: string; title: string | null; removed_at: string }[],
  titles: [] as { tmdb_id: string; type: string; title?: string; poster_path: string; release_year: number; runtime_minutes: number; tmdb_rating: number }[],
  titleRequests: 0,
  failTitles: false,
}))

function query(table: string) {
  const f: { eq: [string, unknown][]; in?: string[]; range?: [number, number] } = { eq: [] }
  const q = {
    select: () => q,
    eq: (k: string, v: unknown) => (f.eq.push([k, v]), q),
    in: (_k: string, ids: string[]) => ((f.in = ids), q),
    order: () => q,
    range: (a: number, b: number) => ((f.range = [a, b]), q),
    then: (done: (v: unknown) => unknown) => {
      let rows: unknown[]
      if (table === 'titles') {
        db.titleRequests++
        const type = f.eq.find(([k]) => k === 'type')?.[1]
        rows = db.titles.filter((t) => f.in!.includes(t.tmdb_id) && (!type || t.type === type))
      } else {
        rows = table === 'recommendation_feedback' ? db.feedback : db.removed
        if (f.range) rows = rows.slice(f.range[0], f.range[1] + 1)
      }
      if (table === 'titles' && db.failTitles) return Promise.resolve({ data: null, error: { message: 'boom' } }).then(done)
      // PostgREST's cap: never more than 1,000 rows in one answer.
      return Promise.resolve({ data: rows.slice(0, CAP), error: null }).then(done)
    },
  }
  return q
}

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ from: query }) }))
vi.mock('@/lib/supabase/auth-user', () => ({ getAuthUser: async () => ({ id: 'u1' }) }))

import { GET } from '@/app/api/recommendations/ratings/route'
import type { RatingsSummary } from '@/app/api/recommendations/ratings/route'

describe('GET /api/recommendations/ratings past 1,000 rows', () => {
  afterEach(() => {
    db.failTitles = false
    vi.restoreAllMocks()
  })

  it('returns every rating and finds every poster', async () => {
    const at = (i: number) => new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString()
    db.feedback = Array.from({ length: 1200 }, (_, i) => ({
      recommendation_id: `movie:${i}`, title: `Film ${i}`, rating: 'loved', created_at: at(1200 - i),
    }))
    db.removed = Array.from({ length: 50 }, (_, i) => ({ tmdb_id: String(5000 + i), media_type: 'tv', title: `Show ${i}`, removed_at: at(i) }))
    // Every id is also a series with the same number, as in the real catalogue: asking per type keeps them out.
    db.titles = [
      ...db.feedback.map((_, i) => ({ tmdb_id: String(i), type: 'movie', poster_path: `/m${i}.jpg`, release_year: 2000, runtime_minutes: 100, tmdb_rating: 7 })),
      ...db.feedback.map((_, i) => ({ tmdb_id: String(i), type: 'tv', poster_path: `/t${i}.jpg`, release_year: 2001, runtime_minutes: 40, tmdb_rating: 8 })),
      ...db.removed.map((r) => ({ tmdb_id: r.tmdb_id, type: 'tv', poster_path: `/r${r.tmdb_id}.jpg`, release_year: 2010, runtime_minutes: 45, tmdb_rating: 7.5 })),
    ]
    const res = await GET()
    const body = (await res.json()) as RatingsSummary
    expect(body.items).toHaveLength(1200)
    expect(body.counts.loved).toBe(1200)
    expect(body.items.every((i) => i.poster_url?.includes('/m') && i.year === 2000 && i.meta === '1h 40m')).toBe(true)
    expect(body.removed).toHaveLength(50)
    expect(body.removed.every((r) => r.poster_url?.includes('/r') && r.meta === '~45m episodes')).toBe(true)
    // 1,200 movie ids in chunks of 300, and one chunk for the 50 series.
    expect(db.titleRequests).toBe(5)
  })

  it('a failed titles chunk: the list still loads, without those posters, and the log says so', async () => {
    db.feedback = [{ recommendation_id: 'movie:1', title: 'Film 1', rating: 'liked', created_at: '2026-11-01T00:00:00Z' }]
    db.removed = []
    db.failTitles = true
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await GET()
    expect(res.status).toBe(200)
    const body = (await res.json()) as RatingsSummary
    expect(body.items.map((i) => [i.title, i.poster_url, i.year])).toEqual([['Film 1', null, null]])
    expect(log).toHaveBeenCalledTimes(1)
    expect(String(log.mock.calls[0][0])).toContain('[ratings] titles chunk failed')
  })

  it('a rating or hidden title saved with no name gets the catalogue\'s (#406); a real name stays', async () => {
    db.feedback = [
      { recommendation_id: 'movie:278', title: null, rating: 'loved', created_at: '2026-11-02T00:00:00Z' },
      { recommendation_id: 'tv:9', title: 'My name', rating: 'liked', created_at: '2026-11-01T00:00:00Z' },
      { recommendation_id: 'movie:7', title: '  Padded  ', rating: 'liked', created_at: '2026-11-01T00:00:00Z' },
      { recommendation_id: 'movie:404', title: null, rating: 'liked', created_at: '2026-11-01T00:00:00Z' },
    ]
    db.removed = [{ tmdb_id: '1396', media_type: 'tv', title: null, removed_at: '2026-11-01T00:00:00Z' }]
    db.titles = [
      { tmdb_id: '278', type: 'movie', title: 'The Shawshank Redemption', poster_path: '/s.jpg', release_year: 1994, runtime_minutes: 142, tmdb_rating: 8.7 },
      { tmdb_id: '9', type: 'tv', title: 'Catalogue name', poster_path: '/n.jpg', release_year: 2020, runtime_minutes: 40, tmdb_rating: 7 },
      { tmdb_id: '1396', type: 'tv', title: 'Breaking Bad', poster_path: '/b.jpg', release_year: 2008, runtime_minutes: 47, tmdb_rating: 9 },
    ]
    const body = (await (await GET()).json()) as RatingsSummary
    expect(body.items.map((i) => [i.id, i.title])).toEqual([['movie:278', 'The Shawshank Redemption'], ['tv:9', 'My name'], ['movie:7', 'Padded'], ['movie:404', null]])
    expect(body.removed.map((r) => r.title)).toEqual(['Breaking Bad'])
  })
})
