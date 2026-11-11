import { describe, it, expect } from 'vitest'

import { rankSpread, spread } from '@/app/play/lib/scales'
import { rankAgainst, spreadOne, normaliseScales, type ScaleNorms } from '@/lib/taste-scales/normalise'
import { tasteFeatures, TASTE_FEATURE_COUNT } from '@/lib/taste-scales/features'
import { catalogueBatchSchema, repairBatch } from '@/lib/taste-scales/prompt'

describe('rankAgainst', () => {
  const set = [1990, 2000, 2000, 2010, 2020]

  it('matches rankSpread for values in the set, ties included', () => {
    const want = rankSpread(set)
    set.forEach((v, i) => expect(rankAgainst(set, v)).toBe(want[i]))
  })

  it('interpolates between set values and clamps outside', () => {
    // 2005 sits halfway between rank 1.5 (the 2000 tie) and rank 3 (2010): 2.25 / 4 → 0.13
    expect(rankAgainst(set, 2005)).toBe(0.13)
    expect(rankAgainst(set, 1950)).toBe(-1)
    expect(rankAgainst(set, 2030)).toBe(1)
  })
})

describe('spreadOne', () => {
  it('matches spread() with the population frozen', () => {
    const raw = [-3, 0, 1, 4, 5]
    const mean = raw.reduce((s, v) => s + v, 0) / raw.length
    const sd = Math.sqrt(raw.reduce((s, v) => s + (v - mean) ** 2, 0) / raw.length)
    expect(raw.map(v => spreadOne(v, mean, sd))).toEqual(spread(raw))
  })
})

describe('normaliseScales', () => {
  const norms: ScaleNorms = {
    ai: { tone: { mean: 0, sd: 2 }, energy: null, pace: null, dark: null, complex: null, fantastic: null, humor: { mean: 0, sd: 2 }, audience: null },
    years: [2000, 2010], votes: { movie: [100, 1000], tv: [10, 100] }, episodes: [10, 100],
  }
  const base = { type: 'movie' as const, release_year: 2010, tmdb_vote_count: 1000, episodes: null, game_genres: [], raw: { tone: 3, humor: 3 } }

  it('gives humor to comedies only and skips unscored scales', () => {
    expect(normaliseScales(base, norms)).toEqual({ tone: 1, modern: 1, indie: -1 })
    expect(normaliseScales({ ...base, game_genres: ['comedy'] }, norms).humor).toBe(1)
  })

  it('puts a title with no votes at the off-beat end, and commit on series only', () => {
    expect(normaliseScales({ ...base, tmdb_vote_count: null }, norms).indie).toBe(1)
    expect(normaliseScales({ ...base, type: 'tv', tmdb_vote_count: 10, episodes: 100 }, norms)).toMatchObject({ indie: 1, commit: 1 })
  })
})

describe('tasteFeatures', () => {
  it('lays out rating, genres, scales, audience in the fixed order', () => {
    const x = tasteFeatures({ tmdb_rating: 20, game_genres: ['drama', 'action'], taste_scales: { commit: 0.5, tone: -0.4, audience: 0.9 } })
    expect(x).toHaveLength(TASTE_FEATURE_COUNT)
    expect(x[0]).toBe(3) // clamped
    expect(x[1]).toBe(0.5) // action
    expect(x[7]).toBe(0.5) // drama
    expect(x[14]).toBe(0.5) // commit
    expect(x[23]).toBe(-0.4) // tone
    expect(x[24]).toBe(0.9) // audience
    expect(x.reduce((s, v) => s + v, 0)).toBeCloseTo(3 + 1 + 0.1 + 0.9)
  })

  it('treats a missing rating and missing scales as 0', () => {
    expect(tasteFeatures({ tmdb_rating: null, game_genres: null, taste_scales: null })).toEqual(new Array(TASTE_FEATURE_COUNT).fill(0))
  })
})

describe('repairBatch', () => {
  it('clamps an off-range audience on the catalogue schema', () => {
    const text = JSON.stringify({ titles: [{ n: 1, tone: 6, energy: 0, pace: 0, dark: 0, complex: 0, fantastic: 0, audience: 7.4, confirmed_genres: ['nope'] }] })
    const out = repairBatch({ text }, catalogueBatchSchema)
    expect(out?.titles[0]).toMatchObject({ tone: 5, audience: 5, humor: null, confirmed_genres: [] })
  })
})
