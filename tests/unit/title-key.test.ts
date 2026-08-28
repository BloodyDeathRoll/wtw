import { describe, it, expect } from 'vitest'
import {
  titleKey,
  parseTitleKey,
  recordKey,
  recordType,
  recordMatches,
  matchesKeySet,
  toRpcKeys,
  isSavedMarker,
} from '@/lib/title-key'
import { unmarkSavedInHistory, markSavedInHistory } from '@/modules/session/watchlist-intent'
import { ratedTmdbIds, cacheServableUnchanged } from '@/modules/session/session-change'
import type { RecommendationRecord, RecommendationResult } from '@/types/dna'

// TMDB movie and TV ids collide (id 105 = Back to the Future AND Sex and the
// City). Everything below guards the one rule that fixes "rated titles keep
// coming back": address a title by type:tmdb_id, and never guess a legacy
// row's type.

function record(overrides: Partial<RecommendationRecord> = {}): RecommendationRecord {
  return {
    session: 1,
    recommended: '105',
    tmdb_id: '105',
    accepted: false,
    watched: false,
    rating: null,
    fingerprint_version: 1,
    ...overrides,
  }
}

const rec = (tmdb_id: string, type: 'movie' | 'tv' = 'movie') =>
  ({ tmdb_id, type } as unknown as RecommendationResult)

describe('titleKey / parseTitleKey', () => {
  it('round-trips', () => {
    expect(parseTitleKey(titleKey('movie', '105'))).toEqual({ type: 'movie', tmdb_id: '105' })
    expect(parseTitleKey('tv:1396')).toEqual({ type: 'tv', tmdb_id: '1396' })
  })

  it('treats anything unprefixed as type-unknown, id intact', () => {
    expect(parseTitleKey('105')).toEqual({ type: null, tmdb_id: '105' })
    expect(parseTitleKey('tt-aftersun')).toEqual({ type: null, tmdb_id: 'tt-aftersun' })
    expect(parseTitleKey('')).toEqual({ type: null, tmdb_id: '' })
  })
})

describe('history records', () => {
  it('reads the type from `recommended`, legacy rows have none', () => {
    expect(recordType(record({ recommended: 'movie:105' }))).toBe('movie')
    expect(recordType(record({ recommended: '105' }))).toBeNull()
    expect(recordKey(record({ recommended: 'tv:105' }))).toBe('tv:105')
    expect(recordKey(record({ recommended: '105' }))).toBe('105')
  })

  it('matches typed rows exactly and legacy rows on the bare id', () => {
    const typed = record({ recommended: 'movie:105' })
    expect(recordMatches(typed, '105', 'movie')).toBe(true)
    expect(recordMatches(typed, '105', 'tv')).toBe(false)
    expect(recordMatches(typed, '105', null)).toBe(true) // caller doesn't know — id match
    const legacy = record({ recommended: '105' })
    expect(recordMatches(legacy, '105', 'movie')).toBe(true)
    expect(recordMatches(legacy, '105', 'tv')).toBe(true)
    expect(recordMatches(legacy, '106', 'movie')).toBe(false)
  })

  it('identifies a watchlist marker and nothing else', () => {
    expect(isSavedMarker(record({ accepted: true }))).toBe(true)
    expect(isSavedMarker(record({ accepted: true, watched: true }))).toBe(false)
    expect(isSavedMarker(record({ accepted: true, rating: 'liked' }))).toBe(false)
    expect(isSavedMarker(record())).toBe(false)
  })
})

describe('matchesKeySet / toRpcKeys', () => {
  it('hits on the composite key or a legacy bare id', () => {
    const keys = new Set(['movie:105', '500'])
    expect(matchesKeySet(keys, 'movie', '105')).toBe(true)
    expect(matchesKeySet(keys, 'tv', '105')).toBe(false) // the other title is fair game
    expect(matchesKeySet(keys, 'movie', '500')).toBe(true) // legacy: unknown type, exclude both
    expect(matchesKeySet(keys, 'tv', '500')).toBe(true)
  })

  it('fans a legacy bare id out to both types for the RPC', () => {
    expect(toRpcKeys(new Set(['movie:105', '500'])).sort()).toEqual(
      ['movie:105', 'movie:500', 'tv:500'].sort(),
    )
  })
})

describe('ratedTmdbIds / cacheServableUnchanged with composite keys', () => {
  it('keys typed rows by type and legacy rows bare', () => {
    expect(
      ratedTmdbIds([
        record({ recommended: 'movie:105', rating: 'loved' }),
        record({ recommended: '500', tmdb_id: '500', rating: 'disliked' }),
        record({ recommended: 'tv:7', tmdb_id: '7', rating: null }),
      ]),
    ).toEqual(new Set(['movie:105', '500']))
  })

  it('does not force a regen for the same-id title of the other type', () => {
    const rated = ratedTmdbIds([record({ recommended: 'movie:105', rating: 'loved' })])
    expect(cacheServableUnchanged(rated, [rec('105', 'tv')])).toBe(true)
    expect(cacheServableUnchanged(rated, [rec('105', 'movie')])).toBe(false)
  })
})

describe('unmarkSavedInHistory', () => {
  const CTX = { session: 4, fingerprintVersion: 7 }

  it('clears the saved marker so the title can be recommended again', () => {
    const saved = markSavedInHistory([], ['movie:105'], CTX)
    const out = unmarkSavedInHistory(saved, ['movie:105'])
    expect(out[0].accepted).toBe(false)
    expect(isSavedMarker(out[0])).toBe(false)
  })

  it('never walks a rating or a watch backwards', () => {
    const history = [
      record({ recommended: 'movie:105', accepted: true, watched: true, rating: 'loved' }),
      record({ recommended: 'movie:106', tmdb_id: '106', accepted: true, rating: 'liked' }),
    ]
    expect(unmarkSavedInHistory(history, ['movie:105', 'movie:106'])).toBe(history)
  })

  it('leaves the other type alone and returns the same array when nothing changed', () => {
    const history = markSavedInHistory([], ['movie:105'], CTX)
    expect(unmarkSavedInHistory(history, ['tv:105'])).toBe(history)
    expect(unmarkSavedInHistory(history, [])).toBe(history)
  })
})
