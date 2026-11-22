import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { RecommendationResult } from '@/types/dna'

// v3 F4 (FOR-YOU.md DEC-6, #351): a For you card you stopped on (half on screen for a second) and left alone rests at
// Refresh — about a week, then about a month — and retires after the third time. A flick doesn't count. Adding, rating
// or hiding it takes it off For you for good. A card back from its rest is never in the top five.

const DAY = 24 * 60 * 60 * 1000
const rec = (i: number) => ({
  tmdb_id: String(100 + i), type: 'movie', title: `t${i}`, composite_score: 1 - i / 100,
  explanation: `why ${i}`, is_stretch_pick: false, generated_at: '', fingerprint_version: 7,
}) as unknown as RecommendationResult
const key = (i: number) => `movie:${100 + i}`
const batchOf = (from: number, n = 50) => Array.from({ length: n }, (_, i) => rec(from + i))

// ── A stand-in for the tables makeTheTwenty reads and the RPCs it calls ──────────────────────────────────────────────
const db = vi.hoisted(() => ({
  madeAt: '2026-11-20T10:00:00.000Z' as string | null,
  restRows: [] as { tmdb_id: string; media_type: string; skips: number; rest_until: string | null }[],
  restReadFails: false,
  removed: [] as { tmdb_id: string; media_type: string }[],
  watchlist: [] as { rec_id: string }[],
  rpcs: [] as { name: string; args: Record<string, unknown> }[],
  upserts: [] as { recs: RecommendationResult[] }[],
}))
vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: (fn: () => unknown) => { void fn() },
}))
vi.mock('@/modules/engine/enrichment/ensure-watch-providers', () => ({ ensureWatchProviders: async () => {} }))
function query(table: string) {
  const q: Record<string, unknown> = {}
  q.select = () => q
  q.eq = () => q
  q.in = async () => ({ data: [], error: null })
  q.gt = async () => (db.restReadFails
    ? { data: null, error: { message: 'column served_titles.skips does not exist' } }
    : { data: db.restRows, error: null })
  q.maybeSingle = async () => ({ data: table === 'for_you_sets' ? { made_at: db.madeAt } : null, error: null })
  q.upsert = async (row: { recs: RecommendationResult[] }) => { db.upserts.push(row); return { error: null } }
  q.then = (res: (v: unknown) => void) => {
    if (table === 'removed_titles') return res({ data: db.removed, error: null })
    if (table === 'watchlist_entries') return res({ data: db.watchlist, error: null })
    return res({ data: [], error: null })
  }
  return q
}
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: query,
    rpc: async (name: string, args: Record<string, unknown>) => { db.rpcs.push({ name, args }); return { data: 0, error: null } },
  }),
}))

const resting = await import('@/lib/resting')
const { REST_DAYS, RETIRE_AT_SKIP, RETURNING_BELOW, restPlan, restSeconds, placeReturning, stopTracker } = resting
const { pickTheTwenty, makeTheTwenty, SET_SIZE } = await import('@/lib/for-you-set')
const { createBlankDNA } = await import('@/modules/dna/blank-dna')

beforeEach(() => {
  db.madeAt = '2026-11-20T10:00:00.000Z'; db.restRows = []; db.restReadFails = false
  db.removed = []; db.watchlist = []; db.rpcs.length = 0; db.upserts.length = 0
})

describe('stopped on vs flicked past (the phone)', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('half the card on screen for a second is stopped on', () => {
    const stops: string[] = []
    const t = stopTracker((k) => stops.push(k))
    t.visible('movie:1', 0.5)
    vi.advanceTimersByTime(999)
    expect(stops).toEqual([])
    vi.advanceTimersByTime(1)
    expect(stops).toEqual(['movie:1'])
  })

  it('a flick (on screen for less than a second) is not', () => {
    const stops: string[] = []
    const t = stopTracker((k) => stops.push(k))
    t.visible('movie:1', 0.9)
    vi.advanceTimersByTime(600)
    t.visible('movie:1', 0.1)
    vi.advanceTimersByTime(5000)
    expect(stops).toEqual([])
  })

  it('less than half on screen never counts, however long', () => {
    const stops: string[] = []
    const t = stopTracker((k) => stops.push(k))
    t.visible('movie:1', 0.49)
    vi.advanceTimersByTime(60_000)
    expect(stops).toEqual([])
  })

  it('reports a card once per 20, and again after a new 20', () => {
    const stops: string[] = []
    const t = stopTracker((k) => stops.push(k))
    for (let i = 0; i < 3; i++) {
      t.visible('movie:1', 1)
      vi.advanceTimersByTime(1500)
      t.visible('movie:1', 0)
    }
    expect(stops).toEqual(['movie:1'])
    t.reset()
    t.visible('movie:1', 1)
    vi.advanceTimersByTime(1500)
    expect(stops).toEqual(['movie:1', 'movie:1'])
  })

  it('leaving the app mid-look drops the half-watched card', () => {
    const stops: string[] = []
    const t = stopTracker((k) => stops.push(k))
    t.visible('movie:1', 1)
    vi.advanceTimersByTime(500)
    t.stop()
    vi.advanceTimersByTime(5000)
    expect(stops).toEqual([])
  })
})

describe('the two rests, then retirement', () => {
  const now = Date.parse('2026-11-22T12:00:00.000Z')
  const row = (skips: number, restDays: number | null) =>
    ({ key: 'movie:1', skips, rest_until: restDays == null ? null : new Date(now + restDays * DAY).toISOString() })

  it('rests about a week, then about a month, and retires at the third skip (Q-1: easy to change)', () => {
    expect(REST_DAYS).toEqual([7, 30])
    expect(restSeconds()).toEqual([7 * 86400, 30 * 86400])
    expect(RETIRE_AT_SKIP).toBe(3)
  })

  it('first skip: left out inside its week, back after it', () => {
    expect(restPlan([row(1, 6.9)], now).blocked.has('movie:1')).toBe(true)
    const after = restPlan([row(1, -0.1)], now)
    expect(after.blocked.has('movie:1')).toBe(false)
    expect(after.returning.has('movie:1')).toBe(true)
  })

  it('second skip: left out inside its month, back one last time after it', () => {
    expect(restPlan([row(2, 29)], now).blocked.has('movie:1')).toBe(true)
    expect(restPlan([row(2, -1)], now).returning.has('movie:1')).toBe(true)
  })

  it('third skip: retired for good, whatever the date', () => {
    for (const r of [row(3, null), row(3, -365), row(4, null)]) {
      const plan = restPlan([r], now)
      expect(plan.blocked.has('movie:1')).toBe(true)
      expect(plan.returning.has('movie:1')).toBe(false)
    }
  })

  it('never skipped (flicked past, never reached): neither resting nor returning, as if never shown', () => {
    const plan = restPlan([row(0, null)], now)
    expect(plan.blocked.size + plan.returning.size).toBe(0)
  })
})

describe('a returning card is never in the top five', () => {
  it('moves below the first five, the rest keeping their order', () => {
    const out = placeReturning([1, 2, 3, 4, 5, 6, 7, 8], (n) => n === 1 || n === 3)
    expect(out).toEqual([2, 4, 5, 6, 7, 1, 3, 8])
    expect(RETURNING_BELOW).toBe(5)
  })

  it('in the 20: resting ones out (even as a top-up), returning ones from place six', () => {
    const batch = batchOf(0, 30)
    const rest = { blocked: new Set([key(1), key(25)]), returning: new Set([key(0), key(2)]) }
    const set = pickTheTwenty(batch, () => true, [rec(25)], rest)
    const keys = set.map((r) => `movie:${r.tmdb_id}`)
    expect(set).toHaveLength(SET_SIZE)
    expect(keys).not.toContain(key(1))
    expect(keys).not.toContain(key(25))
    expect(keys.slice(0, 5)).toEqual([key(3), key(4), key(5), key(6), key(7)])
    expect(keys.slice(5, 7)).toEqual([key(0), key(2)])
  })

  it('without the rest state, the 20 are exactly F1\'s', () => {
    const batch = batchOf(0)
    expect(pickTheTwenty(batch, () => true, [rec(0)])).toEqual(pickTheTwenty(batch, () => true, [rec(0)], resting.NO_REST))
  })
})

describe('Refresh counts the skips, and any add, rate or hide ends the cycle', () => {
  const dnaWith = (ratedIds: number[]) => {
    const d = createBlankDNA('u1')
    d.signals = ratedIds.map((i) => ({ tmdb_id: String(100 + i), type: 'movie' })) as unknown as typeof d.signals
    return d
  }
  // The outgoing 20 are 0–19: 0 rated, 1 saved, 2 hidden, the rest left alone.
  const make = (dna = dnaWith([0])) => {
    db.watchlist = [{ rec_id: key(1) }]
    db.removed = [{ tmdb_id: '102', media_type: 'movie' }]
    return makeTheTwenty({
      userId: 'u1', dna, batch: batchOf(0, 60), removed: Promise.resolve(new Set([key(2)])),
      contentType: 'movies', previous: batchOf(0, 20), source: 'refresh', mustKeep: true,
    })
  }

  it('only cards left alone can be counted as skipped, since the 20 was made, with the two rests', async () => {
    await make()
    const call = db.rpcs.find((r) => r.name === 'rest_skipped_titles')!
    expect(call.args.p_since).toBe(db.madeAt)
    expect(call.args.p_rest_secs).toEqual([7 * 86400, 30 * 86400])
    const keys = call.args.p_keys as string[]
    expect(keys).toHaveLength(17)
    for (const acted of [key(0), key(1), key(2)]) expect(keys).not.toContain(acted)
  })

  it('a rated, saved or hidden title never comes back, even when it was resting and its rest is over', async () => {
    db.restRows = [0, 1, 2].map((i) => ({ tmdb_id: String(100 + i), media_type: 'movie', skips: 1, rest_until: '2026-01-01T00:00:00Z' }))
    const page = await make()
    const ids = page.recommendations.map((r) => r.id)
    for (const acted of [key(0), key(1), key(2)]) expect(ids).not.toContain(acted)
    const stored = db.upserts[0].recs.map((r) => `movie:${r.tmdb_id}`)
    for (const acted of [key(0), key(1), key(2)]) expect(stored).not.toContain(acted)
  })

  it('a resting title is left out of the new 20; a returning one sits below the top five', async () => {
    db.restRows = [
      { tmdb_id: '125', media_type: 'movie', skips: 1, rest_until: new Date(Date.now() + 3 * DAY).toISOString() },
      { tmdb_id: '120', media_type: 'movie', skips: 2, rest_until: new Date(Date.now() - DAY).toISOString() },
    ]
    const page = await make()
    const ids = page.recommendations.map((r) => r.id)
    expect(ids).not.toContain(key(25))
    expect(ids.indexOf(key(20))).toBeGreaterThanOrEqual(5)
  })

  it('when the rest state can\'t be read (no migration 0035), the Refresh still works, as F1 made it', async () => {
    db.restReadFails = true
    const page = await make()
    expect(page.recommendations).toHaveLength(SET_SIZE)
    expect(page.recommendations[0].id).toBe(key(20))
  })

  it('a first 20 (no Refresh) counts nothing, but still leaves resting titles out', async () => {
    db.restRows = [{ tmdb_id: '100', media_type: 'movie', skips: 1, rest_until: new Date(Date.now() + DAY).toISOString() }]
    const page = await makeTheTwenty({
      userId: 'u1', dna: createBlankDNA('u1'), batch: batchOf(0), removed: new Set<string>(),
      contentType: 'movies', source: 'cache', mustKeep: false,
    })
    expect(db.rpcs.some((r) => r.name === 'rest_skipped_titles')).toBe(false)
    expect(page.recommendations.map((r) => r.id)).not.toContain(key(0))
  })
})
