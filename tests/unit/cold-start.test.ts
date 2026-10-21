import { describe, it, expect } from 'vitest'
import {
  COLD_START_SIGNALS,
  NO_PLAY_GENRES,
  isColdStart,
  rankColdStart,
  toColdStartResult,
  type ColdStartTitle,
  type PlayGenres,
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

describe('toColdStartResult', () => {
  it('makes no match claim and says why in plain words', () => {
    const r = toColdStartResult(title({ tmdb_id: '7', title: 'Big Hit', tmdb_rating: 8.1, tmdb_vote_count: 12_400 }), 3, 'now')
    expect(r.composite_score).toBe(0)
    expect(r.is_stretch_pick).toBe(false)
    expect(r.fingerprint_version).toBe(3)
    expect(r.explanation).toMatch(/^Popular and well rated — 8\.1 on TMDB from 12k ratings\./)
    expect(r.reason_payload.external_ratings).toEqual([{ source: 'tmdb', score: 0.81 }])
    expect(r.reason_payload.crew_matches).toEqual([])
  })
})
