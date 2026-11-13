import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { applyGenreStep } from '@/app/onboarding/lib/genre-step'
import { candidateGenres } from '@/app/play/lib/genres'
import { genre16Rule, isExcluded } from '@/lib/exclusion-rules'
import { FEATURE_GENRES, FEATURE_SCALES, tasteFeatures } from '@/lib/taste-scales/features'
import { createBlankDNA } from '@/modules/dna/blank-dna'
import { never16Of } from '@/modules/dna/update-from-play'
import { GENRE_LEAN, genreLean, trainTasteModel, type TastePair, type TasteRow } from '@/modules/dna/taste-model'
import { scoreCandidates } from '@/modules/engine/pipeline/step2-composite-score'
import { clearTasteWeights } from '@/modules/engine/scoring/taste-weights'
import type { TitleRow } from '@/modules/engine/types'

// P1-D4b (#278, DEC-13): the genre screen's Love / Like lean the taste model,
// and so the feed. The feed test runs the real step 2 under FORMULA_V2 on a
// fixture; only the database reads are mocked.

const io = vi.hoisted(() => ({
  training: { rows: [] as unknown[], pairs: [] as unknown[], w0: [] as number[] },
  vecs: new Map<string, number[]>(),
}))
vi.mock('@/modules/engine/scoring/lineage-boost', () => ({
  getBoostEligibleIds: () => [],
  fetchLineageCache: async () => new Map(),
  computeBoostFromCaches: () => ({ boost: 0, lineage_connections: [] }),
}))
vi.mock('@/modules/dna/load-taste-training', () => ({ loadTasteTraining: async () => io.training }))
vi.mock('@/modules/engine/scoring/taste-vectors', async (orig) => ({
  ...(await orig<typeof import('@/modules/engine/scoring/taste-vectors')>()),
  fetchTasteVectors: async () => io.vecs,
}))

const at = (genre: (typeof FEATURE_GENRES)[number]) => 1 + FEATURE_GENRES.indexOf(genre)

/** MINSTD, as in taste-model.test.ts: the same draws on every run. */
function generator(seed: number) {
  const M = 2147483647
  let x = seed
  return () => { x = (48271 * x) % M; return x / M }
}

const TMDB_GENRES = ['Comedy', 'Drama', 'Action', 'Science Fiction', 'Horror', 'Thriller']

/** 254 movies with one or two genres: 30 cards, 24 titles in 12 picks, and a pool of 200. */
function fixture() {
  const u = generator(7)
  const titles = Array.from({ length: 254 }, (_, i) => {
    const first = Math.floor(u() * 6), second = Math.floor(u() * 6)
    const genres = [...new Set(u() < 0.5 ? [first] : [first, second])].map(g => ({ name: TMDB_GENRES[g] }))
    const taste_scales = Object.fromEntries([...FEATURE_SCALES, 'audience' as const].map(s => [s, u() * 2 - 1]))
    const tmdb_rating = 6 + u() * 3
    const row = {
      tmdb_id: String(i), type: 'movie', title: `t${i}`, genres, keywords: [], original_language: 'en',
      crew: { directors: [], writers: [], cinematographers: [], cast: [] },
      tone_tags: [], pacing_tag: null, release_year: 2015, runtime_minutes: 100,
      tmdb_rating, tmdb_vote_count: 1000, omdb_rating: null, narrative_embedding: null,
    } as unknown as TitleRow
    const game_genres = candidateGenres({ type: 'movie', genres, keywords: [], original_language: 'en' }).firm
    return { row, humor: taste_scales.humor, vec: tasteFeatures({ tmdb_rating, game_genres, taste_scales }) }
  })
  // This person's answers follow how funny a title is, not its genre: the cards and picks say nothing for or against sci-fi.
  const rows: TasteRow[] = titles.slice(0, 30).map(t => ({ vec: t.vec, level: t.humor > 0.33 ? 3 : t.humor < -0.33 ? 1 : 2, weight: 1 }))
  const pairs: TastePair[] = Array.from({ length: 12 }, (_, k) => {
    const a = titles[30 + 2 * k], b = titles[31 + 2 * k]
    return a.humor >= b.humor ? { chosen: a.vec, other: b.vec } : { chosen: b.vec, other: a.vec }
  })
  return { rows, pairs, pool: titles.slice(54) }
}

const has = (t: TitleRow, genre: string) => t.genres.some(g => g.name === genre)

describe('genreLean', () => {
  it('Love pulls a genre by g, Like by half, and Never or no answer not at all', () => {
    const S = applyGenreStep(null, { comedy: 'love', drama: 'like', horror: 'never' })
    const w0 = genreLean(S, 0.8)
    expect(w0[at('comedy')]).toBe(0.8)
    expect(w0[at('drama')]).toBe(0.4)
    expect(w0[at('horror')]).toBe(0)
    expect(w0.filter(v => v !== 0)).toHaveLength(2)
    expect(w0).toHaveLength(25)
  })

  it('where two of the 16 chips share an input, the stronger answer wins', () => {
    expect(genreLean(applyGenreStep(null, { scifi: 'like', fantasy: 'never', hero: 'love' }), 1)[at('scifi')]).toBe(1)
    expect(genreLean(applyGenreStep(null, { adultanim: 'like', anim: 'never' }), 1)[at('anim')]).toBe(0.5)
  })

  it('reads what was said, not the values that drift with picks', () => {
    const S = applyGenreStep(null, { comedy: 'love', drama: 'like' })
    S.gen.comedy = 0.4   // picks pulled Love down
    S.gen.drama = 7      // and Like far up
    S.gen.crime = 3      // and raised a genre never answered
    const w0 = genreLean(S, 1)
    expect([w0[at('comedy')], w0[at('drama')], w0[at('crime')]]).toEqual([1, 0.5, 0])
  })

  it('a genre that later became a Never stops leaning', () => {
    const S = applyGenreStep(null, { comedy: 'love' })
    S.gen.comedy = -9
    expect(genreLean(S, 1).every(v => v === 0)).toBe(true)
  })

  it('no saved answers: no lean', () => {
    expect(genreLean(null).every(v => v === 0)).toBe(true)
    expect(genreLean(applyGenreStep(null, {})).every(v => v === 0)).toBe(true)
  })
})

describe('trainTasteModel with a lean', () => {
  const { rows, pairs } = fixture()
  const lean = genreLean(applyGenreStep(null, { scifi: 'love', comedy: 'like' }), 1)

  it('with no genre answers, w is exactly what it is without the lean', () => {
    expect(trainTasteModel(rows, pairs, genreLean(null))).toEqual(trainTasteModel(rows, pairs))
  })

  it('no ratings and no picks: w is w0', () => {
    expect(trainTasteModel([], [], lean)).toEqual(lean)
  })

  it('solves (XᵀWX + Λ) w = XᵀWy + Λ·w0', () => {
    const w = trainTasteModel(rows, pairs, lean)
    const penalty = [0.5, ...new Array(24).fill(4)]
    const mean = rows.reduce((s, r) => s + r.level, 0) / rows.length
    const data = [
      ...rows.map(r => ({ x: r.vec, y: r.level - mean })),
      ...pairs.map(p => ({ x: p.chosen.map((v, k) => v - p.other[k]), y: 1 })),
    ]
    for (let i = 0; i < 25; i++) {
      // Row i of the equation, written out: Σ x_i·(x·w − y) + λ_i·(w_i − w0_i) = 0.
      const residual = data.reduce((s, { x, y }) => s + x[i] * (x.reduce((d, v, k) => d + v * w[k], 0) - y), 0) + penalty[i] * (w[i] - lean[i])
      expect(Math.abs(residual), `row ${i}`).toBeLessThan(1e-9)
    }
  })

  it('fades as ratings come in: 20 times the ratings leave a fraction of the lean', () => {
    const gap = (r: TasteRow[]) => Math.abs(trainTasteModel(r, pairs, lean)[at('scifi')] - trainTasteModel(r, pairs)[at('scifi')])
    const many = Array.from({ length: 20 }, () => rows).flat()
    expect(gap(rows)).toBeGreaterThan(0.1)
    expect(gap(many)).toBeLessThan(gap(rows) / 5)
  })
})

describe('the feed after onboarding (30 cards + 12 picks, formula v2)', () => {
  beforeEach(() => { clearTasteWeights(); process.env.FORMULA_V2 = 'true' })
  afterEach(() => { delete process.env.FORMULA_V2 })

  it('Loved sci-fi: more sci-fi in the top 20 than with no lean, and nothing from a Never genre', async () => {
    const { rows, pairs, pool } = fixture()
    const S = applyGenreStep(null, { scifi: 'love', comedy: 'like', horror: 'never' })
    // Never is a rule (update-from-play.ts writes it); step 1 drops what it names before step 2 scores.
    const rules = never16Of(S).map(genre16Rule)
    const candidates = pool.filter(t => !isExcluded(t.row, rules))
    expect(candidates.length).toBeLessThan(pool.length)
    io.vecs = new Map(candidates.map(t => [`movie:${t.row.tmdb_id}`, t.vec]))

    const top20 = async (w0: number[]) => {
      io.training = { rows, pairs, w0 }
      return (await scoreCandidates(candidates.map(t => t.row), createBlankDNA('u1'))).slice(0, 20).map(s => s.title)
    }
    const lean = genreLean(S)
    expect(lean[at('scifi')]).toBe(GENRE_LEAN)
    expect(lean[at('horror')]).toBe(0)
    const without = await top20(genreLean(null)), withLean = await top20(lean)

    const scifi = (ts: TitleRow[]) => ts.filter(t => has(t, 'Science Fiction')).length
    expect(scifi(withLean)).toBeGreaterThan(scifi(without))
    expect(withLean.filter(t => has(t, 'Horror'))).toEqual([])
  })
})
