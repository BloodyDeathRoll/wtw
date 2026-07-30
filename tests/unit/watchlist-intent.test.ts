import { describe, it, expect } from 'vitest'
import { markSavedInHistory } from '@/modules/session/watchlist-intent'
import type { RecommendationRecord, Reaction } from '@/types/dna'

// A watchlist save is an INTEREST signal: accepted, not watched, not rated. The
// tests that matter are the ones proving it never walks a stronger signal
// backwards — a rating must always outrank a save.

const CTX = { session: 4, fingerprintVersion: 7 }

function entry(overrides: Partial<RecommendationRecord> = {}): RecommendationRecord {
  return {
    session: 1,
    recommended: '1396',
    tmdb_id: '1396',
    accepted: false,
    watched: false,
    rating: null,
    fingerprint_version: 3,
    ...overrides,
  }
}

describe('markSavedInHistory', () => {
  it('marks an existing unrated entry as accepted but not watched', () => {
    const out = markSavedInHistory([entry()], ['movie:1396'], CTX)

    expect(out).toHaveLength(1)
    expect(out[0].accepted).toBe(true)
    expect(out[0].watched).toBe(false)
    expect(out[0].rating).toBeNull()
  })

  it('leaves the rest of the entry untouched', () => {
    const original = entry({ session: 2, fingerprint_version: 5 })
    const out = markSavedInHistory([original], ['movie:1396'], CTX)

    expect(out[0].session).toBe(2)
    expect(out[0].fingerprint_version).toBe(5)
    expect(out[0].recommended).toBe('1396')
  })

  it('creates an entry for a title with no history (served from the rec cache)', () => {
    const out = markSavedInHistory([], ['tv:1396'], CTX)

    expect(out).toHaveLength(1)
    expect(out[0]).toEqual({
      session: 4,
      recommended: '1396',
      tmdb_id: '1396',
      accepted: true,
      watched: false,
      rating: null,
      fingerprint_version: 7,
    })
  })

  it('does not mutate the input array', () => {
    const history = [entry()]
    const out = markSavedInHistory(history, ['movie:1396'], CTX)

    expect(history[0].accepted).toBe(false)
    expect(out).not.toBe(history)
  })
})

describe('a rating always outranks a save', () => {
  it('does not clobber an entry already watched', () => {
    const watched = entry({ accepted: true, watched: true, rating: 'loved' as Reaction })
    const out = markSavedInHistory([watched], ['movie:1396'], CTX)

    expect(out[0].watched).toBe(true)
    expect(out[0].rating).toBe('loved')
  })

  it('does not resurrect a disliked (skipped) title as accepted', () => {
    const skipped = entry({ accepted: false, watched: false, rating: 'disliked' as Reaction })
    const out = markSavedInHistory([skipped], ['movie:1396'], CTX)

    expect(out[0].accepted).toBe(false)
    expect(out[0].rating).toBe('disliked')
  })

  it('marks only the newest entry for a title', () => {
    const history = [
      entry({ session: 1, watched: true, rating: 'liked' as Reaction }),
      entry({ session: 2 }),
    ]
    const out = markSavedInHistory(history, ['movie:1396'], CTX)

    expect(out[0].watched).toBe(true) // older entry untouched
    expect(out[1].accepted).toBe(true)
    expect(out).toHaveLength(2)
  })
})

describe('id handling', () => {
  it('splits on the last colon so a colon in the type prefix is safe', () => {
    const out = markSavedInHistory([], ['movie:1396', 'tv:94605'], CTX)
    expect(out.map((h) => h.tmdb_id)).toEqual(['1396', '94605'])
  })

  it('accepts bare mock ids with no type prefix', () => {
    const out = markSavedInHistory([], ['the-holdovers'], CTX)
    expect(out[0].tmdb_id).toBe('the-holdovers')
  })

  it('collapses colliding movie/TV ids onto one history entry', () => {
    // History keys on tmdb_id alone (the DNA contract has no type there), so a
    // movie and a TV title sharing an id share the entry. Documented, not a bug:
    // the watchlist itself keeps them separate.
    const out = markSavedInHistory([], ['movie:1396', 'tv:1396'], CTX)
    expect(out).toHaveLength(1)
    expect(out[0].accepted).toBe(true)
  })

  it('is a no-op for an empty id list, returning the same array', () => {
    const history = [entry()]
    expect(markSavedInHistory(history, [], CTX)).toBe(history)
  })

  it('skips an empty id', () => {
    expect(markSavedInHistory([], [''], CTX)).toHaveLength(0)
  })

  it('is idempotent — re-marking a saved title changes nothing', () => {
    const once = markSavedInHistory([], ['movie:1396'], CTX)
    const twice = markSavedInHistory(once, ['movie:1396'], CTX)

    expect(twice).toHaveLength(1)
    expect(twice[0].accepted).toBe(true)
  })
})
