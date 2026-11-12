import { describe, it, expect } from 'vitest'
import { externalRatingScore } from '@/modules/engine/pipeline/step2-composite-score'

// P1-E1: a title with only one of its two outside ratings used to get half
// its crowd score. tmdb_rating is stored 0–10, omdb_rating 0–1.

describe('externalRatingScore — the crowd score', () => {
  it('TMDB only: the TMDB rating over 10, not halved', () => {
    expect(externalRatingScore({ tmdb_rating: 8, omdb_rating: null })).toBeCloseTo(0.8, 10)
  })

  it('OMDB only: the OMDB rating as stored (already 0–1), not halved or divided by 10', () => {
    expect(externalRatingScore({ tmdb_rating: null, omdb_rating: 0.9 })).toBeCloseTo(0.9, 10)
  })

  it('both: unchanged, 60% TMDB + 40% OMDB', () => {
    expect(externalRatingScore({ tmdb_rating: 8, omdb_rating: 0.9 })).toBeCloseTo(0.6 * 0.8 + 0.4 * 0.9, 10)
  })

  it('a title with one rating scores like a title with two equal ones', () => {
    const both = externalRatingScore({ tmdb_rating: 7, omdb_rating: 0.7 })
    expect(externalRatingScore({ tmdb_rating: 7, omdb_rating: null })).toBeCloseTo(both, 10)
    expect(externalRatingScore({ tmdb_rating: null, omdb_rating: 0.7 })).toBeCloseTo(both, 10)
  })

  it('neither: neutral 0.5', () => {
    expect(externalRatingScore({ tmdb_rating: null, omdb_rating: null })).toBe(0.5)
  })

  it('a rating of 0 counts as a rating, not as missing', () => {
    expect(externalRatingScore({ tmdb_rating: 0, omdb_rating: null })).toBe(0)
    expect(externalRatingScore({ tmdb_rating: null, omdb_rating: 0 })).toBe(0)
  })
})
