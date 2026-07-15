import { describe, it, expect } from 'vitest'
import {
  hasMaterialChange,
  ratedTmdbIds,
  cacheServableUnchanged,
} from '@/modules/session/session-change'
import type {
  SessionSummary,
  DNASignal,
  RecommendationRecord,
  RecommendationResult,
} from '@/types/dna'

// Guards the /api/session/end no-op fast path (the "Find more" slowness fix):
// a summary with nothing to merge must return false so the route skips the
// version bump + cold pipeline; anything real must return true.

function emptySummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    session_number: 1,
    new_signals: [],
    dimension_updates: {},
    open_questions_resolved: [],
    new_open_questions: [],
    recommendation_made: null,
    recommendation_accepted: null,
    ...overrides,
  }
}

const signal = { tmdb_id: '42', title: 'X' } as unknown as DNASignal

describe('hasMaterialChange', () => {
  it('is false for an empty summary (the no-op "Find more" case)', () => {
    expect(hasMaterialChange(emptySummary())).toBe(false)
  })

  it('is true when there are new signals (incl. folded card ratings)', () => {
    expect(hasMaterialChange(emptySummary({ new_signals: [signal] }))).toBe(true)
  })

  it('is true when dimension_updates is non-empty', () => {
    expect(
      hasMaterialChange(
        emptySummary({
          dimension_updates: {
            moral_ambiguity: { value: 'high', confidence: 0.5, notes: '' },
          },
        }),
      ),
    ).toBe(true)
  })

  it('is true when open questions are resolved', () => {
    expect(hasMaterialChange(emptySummary({ open_questions_resolved: ['q1'] }))).toBe(true)
  })

  it('is true when new open questions are added', () => {
    expect(hasMaterialChange(emptySummary({ new_open_questions: ['q2'] }))).toBe(true)
  })

  it('is true when a recommendation was made (defensive — always null today)', () => {
    expect(hasMaterialChange(emptySummary({ recommendation_made: 'tt123' }))).toBe(true)
  })
})

// ── Stale-cache guard (the second half of the session/end fast-path decision).
// Together these ensure a "Find more" after rating — and a cold cache — both
// regenerate instead of re-serving stale recs or dropping to mocks.

function record(overrides: Partial<RecommendationRecord> = {}): RecommendationRecord {
  return {
    session: 1,
    recommended: '',
    tmdb_id: '1',
    accepted: false,
    watched: false,
    rating: null,
    fingerprint_version: 1,
    ...overrides,
  }
}

const rec = (tmdb_id: string, type: 'movie' | 'tv' = 'movie') =>
  ({ tmdb_id, type } as unknown as RecommendationResult)

describe('ratedTmdbIds', () => {
  it('collects only history entries with a non-null rating', () => {
    const ids = ratedTmdbIds([
      record({ tmdb_id: '10', rating: 'loved' }),
      record({ tmdb_id: '11', rating: null }), // shown but not rated
      record({ tmdb_id: '12', rating: 'disliked' }),
    ])
    expect(ids).toEqual(new Set(['10', '12']))
  })

  it('is empty when nothing has been rated', () => {
    expect(ratedTmdbIds([record({ rating: null })]).size).toBe(0)
  })
})

describe('cacheServableUnchanged', () => {
  const rated = new Set(['10'])

  it('is false for a cold cache (null/empty) — regenerate, never mocks', () => {
    expect(cacheServableUnchanged(rated, null)).toBe(false)
    expect(cacheServableUnchanged(rated, [])).toBe(false)
  })

  it('is false when the cache still holds a rated title — regenerate to drop it', () => {
    expect(cacheServableUnchanged(rated, [rec('99'), rec('10')])).toBe(false)
  })

  it('is true for a warm cache with no rated title — take the fast path', () => {
    expect(cacheServableUnchanged(rated, [rec('99'), rec('98')])).toBe(true)
  })

  it('is true for a warm cache when nothing has been rated', () => {
    expect(cacheServableUnchanged(new Set(), [rec('99')])).toBe(true)
  })

  it('matches on tmdb_id alone — a cross-type id collision forces a (fail-safe) regen', () => {
    // Rated a movie 10; cache holds TV 10. Direction is fail-safe: an
    // unnecessary regen, never a missed one (see issue #30 for candidate-gen).
    expect(cacheServableUnchanged(rated, [rec('10', 'tv')])).toBe(false)
  })
})
