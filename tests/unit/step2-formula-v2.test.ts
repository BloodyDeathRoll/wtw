import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { scoreCandidates } from '@/modules/engine/pipeline/step2-composite-score'
import { clearTasteWeights } from '@/modules/engine/scoring/taste-weights'
import { createBlankDNA } from '@/modules/dna/blank-dna'
import type { TitleRow } from '@/modules/engine/types'

// P1-E3: step 2 under FORMULA_V2. The database reads are mocked: the
// narrative RPC, the lineage cache, the taste training and the candidates'
// taste vectors.

const io = vi.hoisted(() => ({
  narrativeCalls: 0,
  trainingFails: false,
  // A one-input model: the score is 2 × the vector's first entry.
  training: { rows: [] as { vec: number[]; level: 1 | 2 | 3; weight: number }[], pairs: [] as { chosen: number[]; other: number[] }[] },
  vecs: new Map<string, number[]>(),
}))

vi.mock('@/modules/engine/scoring/narrative-match', () => ({
  computeNarrativeMatchScores: async (_b: unknown, _c: unknown, _u: string, _v: number, ids: string[]) => {
    io.narrativeCalls++
    return new Map(ids.map((id, i) => [`movie:${id}`, i / 10]))
  },
}))
vi.mock('@/modules/engine/scoring/lineage-boost', () => ({
  getBoostEligibleIds: () => [],
  fetchLineageCache: async () => new Map(),
  computeBoostFromCaches: () => ({ boost: 0, lineage_connections: [] }),
}))
vi.mock('@/modules/dna/load-taste-training', () => ({
  loadTasteTraining: async () => {
    if (io.trainingFails) throw new Error('column titles.taste_vec does not exist')
    return io.training
  },
}))
vi.mock('@/modules/engine/scoring/taste-vectors', async (orig) => ({
  ...(await orig<typeof import('@/modules/engine/scoring/taste-vectors')>()),
  fetchTasteVectors: async () => io.vecs,
}))
vi.mock('@/modules/dna/taste-model', async (orig) => ({
  ...(await orig<typeof import('@/modules/dna/taste-model')>()),
  trainTasteModel: () => [2, ...new Array(24).fill(0)],
}))

const title = (tmdb_id: string, tmdb_rating: number): TitleRow => ({
  tmdb_id, type: 'movie', title: tmdb_id, genres: [], keywords: [], original_language: 'en',
  crew: { directors: [], writers: [], cinematographers: [], cast: [] },
  tone_tags: [], pacing_tag: null, release_year: 2015, runtime_minutes: 100,
  tmdb_rating, tmdb_vote_count: 1000, omdb_rating: null, narrative_embedding: null,
} as unknown as TitleRow)

const vec = (first: number) => [first, ...new Array(24).fill(0)]

beforeEach(() => {
  clearTasteWeights() // one training per user + taste_version is memoised; each test starts fresh
  io.narrativeCalls = 0
  io.trainingFails = false
  io.vecs = new Map()
  delete process.env.FORMULA_V2
})
afterEach(() => { delete process.env.FORMULA_V2 })

describe('step 2 — flag off (today)', () => {
  it('runs the narrative RPC and leaves formula_v2 unset', async () => {
    const out = await scoreCandidates([title('a', 7), title('b', 8)], createBlankDNA('u1'))
    expect(io.narrativeCalls).toBe(1)
    expect(out.every(s => s.formula_v2 === undefined)).toBe(true)
  })
})

describe('step 2 — FORMULA_V2 on', () => {
  beforeEach(() => { process.env.FORMULA_V2 = 'true' })

  it('skips the narrative RPC and sets narrative to 0.5', async () => {
    const out = await scoreCandidates([title('a', 7), title('b', 8)], createBlankDNA('u1'))
    expect(io.narrativeCalls).toBe(0)
    expect(out.every(s => s.narrative_match_score === 0.5)).toBe(true)
  })

  it('ranks by the taste model over the crowd, with the parts stored', async () => {
    // "liked" has the lower crowd score but the much higher model score.
    io.vecs = new Map([['movie:liked', vec(1)], ['movie:meh', vec(-1)]])
    const out = await scoreCandidates([title('meh', 8), title('liked', 7)], createBlankDNA('u1'))

    expect(out.map(s => s.title.tmdb_id)).toEqual(['liked', 'meh'])
    const [liked, meh] = out
    expect(liked.formula_v2?.model_score).toBe(2)
    expect(meh.formula_v2?.model_score).toBe(-2)
    expect(liked.formula_v2?.z_model).toBeCloseTo(1, 12)
    expect(liked.formula_v2?.z_crowd).toBeCloseTo(-1, 12)
    expect(liked.composite_score).toBe(liked.formula_v2?.composite)
    expect(liked.composite_score).toBeGreaterThan(0.5)
    expect(liked.composite_score).toBeLessThan(1)
  })

  it('a title with no vector scores at the pool mean on the model', async () => {
    io.vecs = new Map([['movie:a', vec(1)], ['movie:c', vec(-1)]])
    const out = await scoreCandidates([title('a', 7), title('b', 7), title('c', 7)], createBlankDNA('u1'))
    const b = out.find(s => s.title.tmdb_id === 'b')!
    expect(b.formula_v2?.model_score).toBeNull()
    expect(b.formula_v2?.z_model).toBe(0)
    expect(b.composite_score).toBeCloseTo(0.5, 12)
  })

  it('does not match a series to a movie that shares its id', async () => {
    io.vecs = new Map([['tv:a', vec(1)]])
    const out = await scoreCandidates([title('a', 7), title('b', 8)], createBlankDNA('u1'))
    expect(out.find(s => s.title.tmdb_id === 'a')?.formula_v2?.model_score).toBeNull()
  })

  it('if the model cannot load, scores on creators and crowd and keeps the feed', async () => {
    io.trainingFails = true
    io.vecs = new Map([['movie:a', vec(1)]])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = await scoreCandidates([title('a', 6), title('b', 8)], createBlankDNA('u1'))

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[step2] taste model unavailable'), expect.stringContaining('taste_vec'))
    expect(out.map(s => s.title.tmdb_id)).toEqual(['b', 'a']) // the crowd decides
    expect(out.every(s => s.formula_v2?.z_model === 0)).toBe(true)
    warn.mockRestore()
  })

  it('an empty pool returns nothing without loading anything', async () => {
    expect(await scoreCandidates([], createBlankDNA('u1'))).toEqual([])
  })
})

describe('step 2 shares step 1\'s training', () => {
  beforeEach(() => { process.env.FORMULA_V2 = 'true' })
  it('a generation trains the taste model once, whoever asks first', async () => {
    const { userTasteWeights } = await import('@/modules/engine/scoring/taste-weights')
    const dna = createBlankDNA('u1')
    const first = await userTasteWeights(dna) // what step 1 does
    io.trainingFails = true                   // a second training would now fail…
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = await scoreCandidates([title('a', 7), title('b', 8)], dna)
    expect(warn).not.toHaveBeenCalled()       // …and step 2 never hit it: it reused step 1's
    expect(out.every(s => s.formula_v2 !== undefined)).toBe(true)
    expect(await userTasteWeights(dna)).toBe(first)
    warn.mockRestore()
  })
})

describe('step 2 hands on the genres the viewer rated down (#279 (c))', () => {
  beforeEach(() => { process.env.FORMULA_V2 = 'true' })
  it('every title gets the same list, from strand C', async () => {
    const dna = createBlankDNA('u1')
    dna.strand_c_visceral_specs.genre_affinity = {
      horror: { score: -0.18, confidence: 0.6, sample_size: 5 },
      crime: { score: 0.2, confidence: 0.8, sample_size: 30 },
    }
    io.vecs = new Map([['movie:a', vec(1)]])
    const out = await scoreCandidates([title('a', 7), title('b', 8)], dna)
    expect(out.map(s => s.formula_v2?.rated_down_genres)).toEqual([['horror'], ['horror']])
  })
})
