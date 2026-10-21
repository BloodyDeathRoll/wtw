import { describe, it, expect } from 'vitest'
import {
  COLD_START_SIGNALS,
  NO_PLAY_GENRES,
  evidenceOf,
  isColdStart,
  rankColdStart,
  toColdStartResult,
  type ColdStartTitle,
  type PlayGenres,
  type Taste,
} from '@/modules/engine/pipeline/cold-start'
import { createBlankDNA } from '@/modules/dna/blank-dna'
import type { DNASchema } from '@/types/dna'

// 2026-10-21: a new user (genres chosen, one game, Skip) was served a
// 125-vote Swedish film at "50% match". Until there are enough ratings the
// batch is popular recent crowd-pleasers, tilted to the chosen genres, with
// no match claim. These pin that.

const YEAR = new Date().getFullYear()

const title = (o: Partial<ColdStartTitle> & { tmdb_id: string }): ColdStartTitle => ({
  type: 'movie',
  title: o.tmdb_id,
  release_year: YEAR - 1,
  tmdb_rating: 7.5,
  tmdb_vote_count: 10_000,
  genres: [{ name: 'Drama' }],
  keywords: [],
  original_language: 'en',
  tone_tags: [],
  pacing_tag: null,
  crew: null,
  ...o,
})

const play = (o: Partial<Record<keyof PlayGenres, string[]>>): PlayGenres => ({
  loved: new Set(o.loved ?? []) as PlayGenres['loved'],
  liked: new Set(o.liked ?? []) as PlayGenres['liked'],
  never: new Set(o.never ?? []) as PlayGenres['never'],
})

const none = new Set<string>()

const signal = (i: number): DNASchema['signals'][number] =>
  ({ tmdb_id: String(i), type: 'movie', reaction: 'liked' }) as unknown as DNASchema['signals'][number]

describe('isColdStart', () => {
  it('is true for a blank fingerprint and until the signal bar is met', () => {
    const dna = createBlankDNA('u1')
    expect(isColdStart(dna)).toBe(true)
    dna.signals = Array.from({ length: COLD_START_SIGNALS - 1 }, (_, i) => signal(i))
    expect(isColdStart(dna)).toBe(true)
    dna.signals.push(signal(99))
    expect(isColdStart(dna)).toBe(false)
  })
})

describe('rankColdStart', () => {
  it('ranks the most-voted title first when everything else is equal', () => {
    const pool = [
      title({ tmdb_id: 'small', tmdb_vote_count: 1_200 }),
      title({ tmdb_id: 'big', tmdb_vote_count: 40_000 }),
      title({ tmdb_id: 'mid', tmdb_vote_count: 8_000 }),
    ]
    expect(rankColdStart(pool, NO_PLAY_GENRES, none, none).map(t => t.tmdb_id)).toEqual(['big', 'mid', 'small'])
  })

  it('prefers recent and well-rated titles among the equally popular', () => {
    const byYear = rankColdStart(
      [title({ tmdb_id: 'old', release_year: YEAR - 7 }), title({ tmdb_id: 'new', release_year: YEAR })],
      NO_PLAY_GENRES, none, none,
    ).map(t => t.tmdb_id)
    expect(byYear).toEqual(['new', 'old'])
    const byRating = rankColdStart(
      [title({ tmdb_id: 'meh', tmdb_rating: 6.6 }), title({ tmdb_id: 'loved', tmdb_rating: 8.4 })],
      NO_PLAY_GENRES, none, none,
    ).map(t => t.tmdb_id)
    expect(byRating).toEqual(['loved', 'meh'])
  })

  it('tilts toward the genres chosen in the games: loved over liked over neither', () => {
    const pool = [
      title({ tmdb_id: 'drama', genres: [{ name: 'Drama' }] }),
      title({ tmdb_id: 'comedy', genres: [{ name: 'Comedy' }] }),
      title({ tmdb_id: 'action', genres: [{ name: 'Action' }] }),
    ]
    const order = rankColdStart(pool, play({ loved: ['comedy'], liked: ['action'] }), none, none).map(t => t.tmdb_id)
    expect(order).toEqual(['comedy', 'action', 'drama'])
  })

  it('a genre tilt breaks ties among hits but never lifts a small title over a much bigger one', () => {
    const near = [
      title({ tmdb_id: 'hit', tmdb_vote_count: 40_000, genres: [{ name: 'Drama' }] }),
      title({ tmdb_id: 'comedy', tmdb_vote_count: 20_000, genres: [{ name: 'Comedy' }] }),
    ]
    expect(rankColdStart(near, play({ loved: ['comedy'] }), none, none)[0].tmdb_id).toBe('comedy')
    const far = [
      title({ tmdb_id: 'hit', tmdb_vote_count: 40_000, genres: [{ name: 'Drama' }] }),
      title({ tmdb_id: 'niche', tmdb_vote_count: 1_200, genres: [{ name: 'Comedy' }] }),
    ]
    expect(rankColdStart(far, play({ loved: ['comedy'] }), none, none)[0].tmdb_id).toBe('hit')
  })

  it('never serves a "Never" genre, however popular', () => {
    const pool = [
      title({ tmdb_id: 'horror', tmdb_vote_count: 50_000, genres: [{ name: 'Horror' }] }),
      title({ tmdb_id: 'anime', tmdb_vote_count: 30_000, genres: [{ name: 'Animation' }], original_language: 'ja' }),
      title({ tmdb_id: 'ok' }),
    ]
    const order = rankColdStart(pool, play({ never: ['horror', 'anime'] }), none, none).map(t => t.tmdb_id)
    expect(order).toEqual(['ok'])
  })

  it('drops excluded keys and sends served titles to the back', () => {
    const pool = [
      title({ tmdb_id: 'rated', tmdb_vote_count: 50_000 }),
      title({ tmdb_id: 'shown', tmdb_vote_count: 40_000 }),
      title({ tmdb_id: 'fresh', tmdb_vote_count: 2_000 }),
    ]
    const order = rankColdStart(pool, NO_PLAY_GENRES, new Set(['movie:rated']), new Set(['movie:shown'])).map(t => t.tmdb_id)
    expect(order).toEqual(['fresh', 'shown'])
  })

  it('caps the batch', () => {
    const pool = Array.from({ length: 80 }, (_, i) => title({ tmdb_id: `t${i}`, tmdb_vote_count: 1_000 + i }))
    expect(rankColdStart(pool, NO_PLAY_GENRES, none, none, 50)).toHaveLength(50)
  })
})

// The picks get personal gradually (Shahar, 2026-10-21): the fingerprint's
// share of the order grows with evidence, whoever wrote the DNA.
describe('evidenceOf', () => {
  it('is nothing for a blank DNA and grows with genres, taste, crew and ratings', () => {
    const dna = createBlankDNA('u1')
    expect(evidenceOf(dna)).toBe(0)
    // Choosing genres in the games: little, but something.
    dna.strand_c_visceral_specs.genre_affinity = {
      comedy: { score: 0.3, confidence: 0.15, sample_size: 3 },
      action: { score: 0.15, confidence: 0.15, sample_size: 3 },
    }
    const genresOnly = evidenceOf(dna)
    expect(genresOnly).toBeGreaterThan(0.1)
    expect(genresOnly).toBeLessThan(0.3)
    // A few games pushed the tone weights.
    dna.strand_c_visceral_specs.tone_weights.comedic = 0.62
    const withTaste = evidenceOf(dna)
    expect(withTaste).toBeGreaterThan(genresOnly)
    // Ratings.
    dna.signals = Array.from({ length: 8 }, (_, i) => signal(i))
    const withRatings = evidenceOf(dna)
    expect(withRatings).toBeGreaterThan(withTaste)
    // A trusted director.
    dna.strand_a_creative_affinity.directors['525'] = { name: 'Nolan', score: 0.2, confidence: 0.15, sample_size: 2, lineage_boost: 'none' }
    expect(evidenceOf(dna)).toBeGreaterThan(withRatings)
    expect(evidenceOf(dna)).toBeLessThanOrEqual(1)
  })
})

describe('rankColdStart with a fingerprint', () => {
  const taste = (dna = createBlankDNA('u1')): Taste => ({ dna, evidence: evidenceOf(dna) })

  it('a blank DNA changes nothing: the popular order stands', () => {
    const pool = [
      title({ tmdb_id: 'drama', genres: [{ name: 'Drama' }] }),
      title({ tmdb_id: 'comedy', tmdb_vote_count: 9_000, genres: [{ name: 'Comedy' }] }),
    ]
    const plain = rankColdStart(pool, NO_PLAY_GENRES, none, none).map(t => t.tmdb_id)
    const withBlank = rankColdStart(pool, NO_PLAY_GENRES, none, none, 50, undefined, taste()).map(t => t.tmdb_id)
    expect(withBlank).toEqual(plain)
    expect(plain).toEqual(['drama', 'comedy'])
  })

  it('a DNA that loves comedy lifts the comedy among equally popular hits', () => {
    const dna = createBlankDNA('u1')
    dna.strand_c_visceral_specs.genre_affinity = { comedy: { score: 0.3, confidence: 0.3, sample_size: 4 } }
    // Same votes, and the drama sorts first by id, so only the fingerprint can lift the comedy.
    const pool = [
      title({ tmdb_id: 'a-drama', genres: [{ name: 'Drama' }] }),
      title({ tmdb_id: 'b-comedy', genres: [{ name: 'Comedy' }] }),
    ]
    expect(rankColdStart(pool, NO_PLAY_GENRES, none, none, 50, undefined, taste()).map(t => t.tmdb_id)).toEqual(['a-drama', 'b-comedy'])
    expect(rankColdStart(pool, NO_PLAY_GENRES, none, none, 50, undefined, taste(dna)).map(t => t.tmdb_id)).toEqual(['b-comedy', 'a-drama'])
  })

  it('with little evidence a much bigger hit still wins; with a lot, the fingerprint does', () => {
    const pool = [
      title({ tmdb_id: 'hit', tmdb_vote_count: 40_000, genres: [{ name: 'Drama' }], tone_tags: ['dark'] }),
      title({ tmdb_id: 'mine', tmdb_vote_count: 3_000, genres: [{ name: 'Comedy' }], tone_tags: ['comedic'] }),
    ]
    const little = createBlankDNA('u1')
    little.strand_c_visceral_specs.genre_affinity = { comedy: { score: 0.3, confidence: 0.15, sample_size: 3 } }
    expect(rankColdStart(pool, NO_PLAY_GENRES, none, none, 50, undefined, taste(little))[0].tmdb_id).toBe('hit')
    const lots = createBlankDNA('u1')
    lots.strand_c_visceral_specs.genre_affinity = {
      comedy: { score: 0.3, confidence: 0.6, sample_size: 12 },
      drama: { score: -0.2, confidence: 0.5, sample_size: 8 },
      action: { score: 0.2, confidence: 0.3, sample_size: 4 },
      romance: { score: 0.1, confidence: 0.3, sample_size: 4 },
    }
    lots.strand_c_visceral_specs.tone_weights = { cynical: 0.4, warm: 0.5, dark: 0.3, comedic: 0.8, hopeful: 0.5 }
    lots.signals = Array.from({ length: 14 }, (_, i) => signal(i))
    lots.strand_a_creative_affinity.directors = {
      a: { name: 'A', score: 0.3, confidence: 0.4, sample_size: 3, lineage_boost: 'none' },
      b: { name: 'B', score: 0.3, confidence: 0.4, sample_size: 3, lineage_boost: 'none' },
      c: { name: 'C', score: 0.3, confidence: 0.4, sample_size: 3, lineage_boost: 'none' },
    }
    expect(evidenceOf(lots)).toBeGreaterThan(0.9)
    expect(rankColdStart(pool, NO_PLAY_GENRES, none, none, 50, undefined, taste(lots))[0].tmdb_id).toBe('mine')
  })

  it('the play_state genre tilt steps aside once the DNA carries the genres', () => {
    const pool = [
      title({ tmdb_id: 'drama', genres: [{ name: 'Drama' }] }),
      title({ tmdb_id: 'comedy', tmdb_vote_count: 9_000, genres: [{ name: 'Comedy' }] }),
    ]
    const loves = play({ loved: ['comedy'] })
    // Before the games wrote the DNA: the tilt from play_state lifts comedy.
    expect(rankColdStart(pool, loves, none, none, 50, undefined, taste())[0].tmdb_id).toBe('comedy')
    // After: the DNA says the opposite, and only the DNA is read.
    const dna = createBlankDNA('u1')
    dna.strand_c_visceral_specs.genre_affinity = { drama: { score: 0.3, confidence: 0.3, sample_size: 4 } }
    expect(rankColdStart(pool, loves, none, none, 50, undefined, taste(dna))[0].tmdb_id).toBe('drama')
  })
})

describe('toColdStartResult', () => {
  it('makes no match claim and says why in plain words', () => {
    const r = toColdStartResult(title({ tmdb_id: '7', title: 'Big Hit', tmdb_rating: 8.1, tmdb_vote_count: 12_400 }), 3, 'now')
    expect(r.composite_score).toBe(0)
    expect(r.is_stretch_pick).toBe(false)
    expect(r.fingerprint_version).toBe(3)
    expect(r.explanation).toMatch(/^Popular and well rated — 8\.1 on TMDB from 12k ratings\. WTW opens/)
    const r2 = toColdStartResult(title({ tmdb_id: '7', title: 'Big Hit', tmdb_rating: 8.1, tmdb_vote_count: 12_400 }), 3, 'now', 0.3)
    expect(r2.explanation).toMatch(/Ordered by what you've shown so far/)
    expect(r2.composite_score).toBe(0)
    expect(r.reason_payload.external_ratings).toEqual([{ source: 'tmdb', score: 0.81 }])
    expect(r.reason_payload.crew_matches).toEqual([])
  })
})
