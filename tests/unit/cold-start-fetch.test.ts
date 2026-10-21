import { describe, it, expect, vi, beforeEach } from 'vitest'

// The fetch layer of cold-start.ts against a scripted service client:
// which columns it asks for, the play_state parsing, and the wider second
// fetch when the top 400 come up short (review of #133, 2026-10-21).

const calls = vi.hoisted(() => ({ selects: [] as string[], limits: [] as number[] }))
const fixture = vi.hoisted(() => ({
  pool: [] as Record<string, unknown>[],
  served: [] as { tmdb_id: string; media_type: string }[],
  play: null as Record<string, unknown> | null,
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      let limit = 0
      const q = {
        select: (cols: string) => { if (table === 'titles') calls.selects.push(cols); return q },
        gte: () => q, eq: () => q, order: () => q,
        limit: (n: number) => { limit = n; calls.limits.push(n); return q },
        maybeSingle: async () => ({ data: fixture.play ? { state: fixture.play } : null, error: null }),
        then: (resolve: (v: unknown) => void) =>
          resolve({
            data: table === 'titles' ? fixture.pool.slice(0, limit) : table === 'served_titles' ? fixture.served : [],
            error: null,
          }),
      }
      return q
    },
  }),
}))

const { coldStartBatch, playGenresOf, poolColumns, isColdStart, COLD_START_SIGNALS } = await import('@/modules/engine/pipeline/cold-start')
const { createBlankDNA } = await import('@/modules/dna/blank-dna')
const { freshState } = await import('@/app/play/lib/brain')

const YEAR = new Date().getFullYear()
const row = (i: number, genre = 'Drama') => ({
  tmdb_id: `t${i}`, type: 'movie', title: `Title ${i}`, release_year: YEAR - 1, tmdb_rating: 7.5,
  tmdb_vote_count: 100_000 - i, genres: [{ name: genre }], keywords: [], original_language: 'en', tone_tags: [],
})

beforeEach(() => {
  calls.selects.length = 0
  calls.limits.length = 0
  fixture.pool = Array.from({ length: 2000 }, (_, i) => row(i))
  fixture.served = []
  fixture.play = null
})

describe('isColdStart — named crew ends it early', () => {
  it('a chat that named a director gets the real pipeline before 15 signals', () => {
    const dna = createBlankDNA('u1')
    expect(dna.signals.length).toBeLessThan(COLD_START_SIGNALS)
    expect(isColdStart(dna)).toBe(true)
    dna.strand_a_creative_affinity.directors['525'] =
      { name: 'Christopher Nolan', score: 0.3, confidence: 0.5, sample_size: 1, lineage_boost: 'none' }
    expect(isColdStart(dna)).toBe(false)
  })
})

describe('playGenresOf', () => {
  it('splits loved from liked and takes "Never" from the brain itself', () => {
    const s = freshState()
    s.sel = ['comedy', 'action', 'drama']
    s.loved = ['comedy']
    s.gen.horror = -9        // "Never" at setup
    s.gen.romance = -2       // merely drifting down — not a Never
    const g = playGenresOf(s)
    expect([...g.loved]).toEqual(['comedy'])
    expect([...g.liked].sort()).toEqual(['action', 'drama'])
    expect([...g.never]).toEqual(['horror'])
  })
  it('is empty without a saved state', () => {
    const g = playGenresOf(null)
    expect(g.loved.size + g.liked.size + g.never.size).toBe(0)
  })
})

describe('poolColumns', () => {
  it('fetches crew only when there are rules to match it against', () => {
    expect(poolColumns(false)).not.toMatch(/crew/)
    expect(poolColumns(true)).toMatch(/, crew$/)
  })
})

describe('coldStartBatch', () => {
  it('one fetch of 400 when the top of the pool fills the batch', async () => {
    const batch = await coldStartBatch(createBlankDNA('u1'), 'movies')
    expect(batch).toHaveLength(50)
    expect(calls.limits).toEqual([400])
    expect(calls.selects[0]).not.toMatch(/crew/)
    expect(batch[0].composite_score).toBe(0)
    expect(batch[0].explanation).toMatch(/^Popular and well rated/)
  })

  it('fetches wider once when "Never" empties the first 400', async () => {
    // The 400 most-voted are all Horror; the catalog's Drama is further down.
    fixture.pool = [
      ...Array.from({ length: 400 }, (_, i) => row(i, 'Horror')),
      ...Array.from({ length: 1600 }, (_, i) => row(400 + i, 'Drama')),
    ]
    fixture.play = { ...freshState(), gen: { ...freshState().gen, horror: -9 } }
    const batch = await coldStartBatch(createBlankDNA('u1'), 'movies')
    expect(calls.limits).toEqual([400, 1000])
    expect(batch).toHaveLength(50)
    expect(batch.every(b => b.tmdb_id.startsWith('t') && Number(b.tmdb_id.slice(1)) >= 400)).toBe(true)
  })

  it('fetches wider when the first 400 would only pad the batch with repeats', async () => {
    // 380 of the top 400 have been served (not rated): the ranking would still
    // return a "full" 50 by appending served titles, so the trigger has to
    // count fresh ones. After the wide fetch the batch is 50 unseen titles.
    fixture.served = Array.from({ length: 380 }, (_, i) => ({ tmdb_id: `t${i}`, media_type: 'movie' }))
    const batch = await coldStartBatch(createBlankDNA('u1'), 'movies')
    expect(calls.limits).toEqual([400, 1000])
    expect(batch).toHaveLength(50)
    expect(batch.every(b => Number(b.tmdb_id.slice(1)) >= 380)).toBe(true)
  })

  it('does not refetch when the first fetch already returned everything eligible', async () => {
    // A thin series pool: 120 rows exist, 100 of them served. Short on fresh
    // titles, but a wider query could only return the same 120.
    fixture.pool = Array.from({ length: 120 }, (_, i) => row(i))
    fixture.served = Array.from({ length: 100 }, (_, i) => ({ tmdb_id: `t${i}`, media_type: 'movie' }))
    const batch = await coldStartBatch(createBlankDNA('u1'), 'series')
    expect(calls.limits).toEqual([400])
    expect(batch).toHaveLength(50)
    expect(batch.slice(0, 20).every(b => Number(b.tmdb_id.slice(1)) >= 100)).toBe(true)   // fresh first
  })

  it('asks for crew when the user has exclusion rules', async () => {
    const dna = createBlankDNA('u1')
    dna.contextual_logic.exclusion_rules.push({ type: 'genre', id: 'r1', name: 'no horror', raw: 'no horror', reason: 'hates horror' })
    await coldStartBatch(dna, 'movies')
    expect(calls.selects[0]).toMatch(/crew/)
  })
})
