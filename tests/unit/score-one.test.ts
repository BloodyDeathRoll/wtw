import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createBlankDNA } from '@/modules/dna/blank-dna'
import { scoreAgainstPool, v2PoolStats, type V2Parts } from '@/modules/engine/scoring/formula-v2'
import type { DNASchema } from '@/types/dna'
import type { ScoredTitle, TitleRow } from '@/modules/engine/types'

// v3 M1: score one title outside a batch, against the user's latest pool,
// and never guess (not in catalogue, cold start, v1 → "not scored").

const io = vi.hoisted(() => ({
  v2: true,
  rows: [] as unknown[],
  saved: null as unknown,
  savedCalls: [] as string[],
  candidates: 0,
  alone: null as unknown,
  byId: {} as Record<string, unknown>,
  poolLists: [] as string[][],
}))
vi.mock('@/lib/flags', async (orig) => ({ ...(await orig<typeof import('@/lib/flags')>()), formulaV2Enabled: () => io.v2 }))
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }) }))
vi.mock('@/modules/engine/why/score-titles', () => ({ loadTitleRows: async () => io.rows }))
vi.mock('@/modules/engine/pipeline/step7-card-reason', async (orig) => ({ ...(await orig<object>()), loadRatedByPerson: async () => new Map() }))
vi.mock('@/modules/engine/pipeline/step1-candidate-gen', () => ({ getCandidates: async () => { io.candidates++; return POOL_ROWS } }))
vi.mock('@/modules/engine/pipeline/step2-composite-score', () => ({
  scoreCandidates: async (rows: TitleRow[]) =>
    rows === POOL_ROWS ? POOL_SCORED : rows.map(r => structuredClone(io.byId[r.tmdb_id] ?? io.alone)),
}))
vi.mock('@/modules/engine/scoring/pool-stats', async (orig) => ({
  ...(await orig<typeof import('@/modules/engine/scoring/pool-stats')>()),
  readPoolStats: async (_u: string, lists: string[]) => { io.poolLists.push(lists); return io.saved },
  savePoolStats: async (_u: string, list: string) => { io.savedCalls.push(list) },
}))

const row = (id: string): TitleRow => ({
  id: 1, tmdb_id: id, title: `Title ${id}`, type: 'movie', synopsis: 'A plot.', genres: [], release_year: 2020,
  runtime_minutes: 100, tmdb_rating: 7.5, tmdb_vote_count: 5000, omdb_rating: null, crew: { directors: [], writers: [], cinematographers: [], cast: [] },
  pacing_tag: null, tone_tags: [], original_language: 'en', keywords: [], narrative_metadata: null, narrative_embedding: null,
  enriched_at: null, created_at: '2026-01-01',
} as unknown as TitleRow)

const scored = (id: string, p: V2Parts): ScoredTitle => ({
  title: row(id), crew_affinity_score: p.creators, external_rating_score: p.crowd,
  narrative_match_score: 0.5, visceral_match_score: 0.5, content_affinity_score: 0.5, content_avoided: false, recency_boost: 0.5,
  composite_score: 0.5, crew_matches: [], lineage_connections: [], dimension_matches: [], soft_preferences_applied: [],
  groq_rationale: '', is_stretch_pick: false, stretch_rationale: null, dimensions_stretched: [],
  formula_v2: { z_creators: 0, z_crowd: 0, z_model: 0, model_score: p.model, s: 0, composite: 0.5, pool_size: 1 },
} as unknown as ScoredTitle)

const POOL_PARTS: V2Parts[] = Array.from({ length: 40 }, (_, i) => ({ creators: (i % 5) / 5, crowd: (i % 7) / 7, model: (i % 9) / 3 - 1.5 }))
const POOL_ROWS = POOL_PARTS.map((_, i) => row(String(1000 + i)))
const POOL_SCORED = POOL_PARTS.map((p, i) => scored(String(1000 + i), p))
const STATS = v2PoolStats(POOL_PARTS)!

/** A profile past cold start: 10 rated titles. */
function readyDNA(): DNASchema {
  const d = createBlankDNA('u1')
  d.signals = Array.from({ length: 10 }, (_, i) => ({ tmdb_id: String(i + 1), type: 'movie', reaction: 'loved' })) as DNASchema['signals']
  return d
}

const { scoreOneTitle, scoreMatches } = await import('@/modules/engine/score-one')
const KEY = { type: 'movie' as const, tmdb_id: '603' }

beforeEach(() => {
  io.v2 = true
  io.rows = [row('603')]
  io.saved = { stats: STATS, taste_version: 4, list: 'all', at: '2026-11-18T10:00:00Z' }
  io.savedCalls = []
  io.candidates = 0
  io.alone = scored('603', { creators: 0.8, crowd: 0.9, model: 1.2 })
  io.byId = {}
  io.poolLists = []
})

describe('scoreOneTitle', () => {
  it('places the title against the saved pool: the match the batch would give it, capped at 97', async () => {
    const r = await scoreOneTitle('u1', KEY, { dna: readyDNA() })
    expect(r.scored).toBe(true)
    if (!r.scored) return
    const expected = scoreAgainstPool({ creators: 0.8, crowd: 0.9, model: 1.2 }, STATS).composite
    expect(r.composite).toBeCloseTo(expected, 12)
    expect(r.match).toBeCloseTo(Math.min(expected, 0.97), 12)
    expect(r.pool).toMatchObject({ n: 40, built: 'saved' })
    expect(io.candidates).toBe(0)
  })

  it('carries the breakdown /explain returns: the taste bars from the pool (it is big enough)', async () => {
    const r = await scoreOneTitle('u1', KEY, { dna: readyDNA() })
    if (!r.scored) throw new Error('not scored')
    expect(r.reason_payload).toHaveProperty('crew_matches')
    expect((r.reason_payload as { taste?: { bars?: unknown } }).taste?.bars).toBeDefined()
    expect(r.is_stretch_pick).toBe(false)
    expect(typeof r.explanation).toBe('string')
  })

  it('with no saved pool, builds it once and saves its stats', async () => {
    io.saved = null
    const r = await scoreOneTitle('u1', KEY, { dna: readyDNA() })
    expect(r.scored && r.pool.built).toBe('fresh')
    expect(io.candidates).toBe(1)
    expect(io.savedCalls).toEqual(['all'])
  })

  it('not in the catalogue: "not scored", never a guess', async () => {
    io.rows = []
    expect(await scoreOneTitle('u1', KEY, { dna: readyDNA() })).toEqual({ scored: false, reason: 'not_in_catalogue' })
  })

  it('cold start: "not scored" (a cold-start feed makes no match claim)', async () => {
    expect(await scoreOneTitle('u1', KEY, { dna: createBlankDNA('u1') })).toEqual({ scored: false, reason: 'cold_start' })
  })

  it('formula v1: "not scored"', async () => {
    io.v2 = false
    expect(await scoreOneTitle('u1', KEY, { dna: readyDNA() })).toEqual({ scored: false, reason: 'formula_v1' })
  })

  it('no profile: "not scored"', async () => {
    expect(await scoreOneTitle('u1', KEY)).toEqual({ scored: false, reason: 'no_profile' })
  })
})

// v3 Q7: the match alone for several titles at once (Search's rows, the Watchlist's rows).
describe('scoreMatches', () => {
  const PARTS: Record<string, V2Parts> = {
    '603': { creators: 0.8, crowd: 0.9, model: 1.2 },
    '680': { creators: 0.1, crowd: 0.4, model: -0.6 },
    '1396': { creators: 0.4, crowd: 0.95, model: 0.3 },
  }
  const tvRow = (id: string) => ({ ...row(id), type: 'tv' }) as TitleRow
  const tvScored = (id: string, p: V2Parts) => ({ ...scored(id, p), title: tvRow(id) }) as ScoredTitle
  const KEYS = [
    { type: 'movie' as const, tmdb_id: '603' },
    { type: 'movie' as const, tmdb_id: '680' },
    { type: 'tv' as const, tmdb_id: '1396' },
  ]

  beforeEach(() => {
    io.rows = [row('603'), row('680'), tvRow('1396')]
    io.byId = { '603': scored('603', PARTS['603']), '680': scored('680', PARTS['680']), '1396': tvScored('1396', PARTS['1396']) }
  })

  it('gives each title the match scoreOneTitle gives it alone', async () => {
    const m = await scoreMatches('u1', KEYS, { dna: readyDNA() })
    for (const k of KEYS) {
      io.rows = [k.type === 'tv' ? tvRow(k.tmdb_id) : row(k.tmdb_id)]
      io.alone = io.byId[k.tmdb_id]
      const one = await scoreOneTitle('u1', k, { dna: readyDNA() })
      if (!one.scored) throw new Error('not scored')
      expect(m[`${k.type}:${k.tmdb_id}`]).toBeCloseTo(one.match, 12)
    }
  })

  it("places each type against its own list's pool, then Both", async () => {
    await scoreMatches('u1', KEYS, { dna: readyDNA() })
    expect(io.poolLists).toEqual([['movies', 'all'], ['series', 'all']])
  })

  it('leaves out a title outside the catalogue: never a guess', async () => {
    io.rows = [row('603')]
    const m = await scoreMatches('u1', [...KEYS, { type: 'tv', tmdb_id: '64010' }], { dna: readyDNA() })
    expect(Object.keys(m)).toEqual(['movie:603'])
  })

  it('with no saved pool, builds it once for all the titles', async () => {
    io.saved = null
    const m = await scoreMatches('u1', KEYS, { dna: readyDNA() })
    expect(Object.keys(m).sort()).toEqual(['movie:603', 'movie:680', 'tv:1396'])
    expect(io.candidates).toBe(1)
    expect(io.savedCalls).toEqual(['all'])
  })

  it('cold start, formula v1, no profile or no titles: nothing', async () => {
    expect(await scoreMatches('u1', KEYS, { dna: createBlankDNA('u1') })).toEqual({})
    expect(await scoreMatches('u1', KEYS)).toEqual({})
    expect(await scoreMatches('u1', [], { dna: readyDNA() })).toEqual({})
    io.v2 = false
    expect(await scoreMatches('u1', KEYS, { dna: readyDNA() })).toEqual({})
  })
})
