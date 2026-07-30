import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  getWatchlist,
  isInWatchlist,
  watchlistCount,
  addToWatchlist,
  removeFromWatchlist,
  setWatchlistRating,
  getUnsyncedIds,
  markSynced,
} from '@/lib/watchlist'
import type { Recommendation } from '@/types/recommendation'
import type { ExplainData } from '@/lib/explain-cache'

// The watchlist is the only copy of a saved card — it holds the whole
// Recommendation so the view renders with no refetch. These tests pin the two
// properties that make it safe: composite-id addressing (TMDB movie/TV ids
// collide) and never throwing on hostile storage.

const STORAGE_KEY = 'wtw_watchlist'

function rec(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    id: 'movie:1396',
    title: 'Breaking Bad',
    type: 'movie',
    year: 2008,
    poster_url: null,
    meta: '1h 45m',
    rating: 8.9,
    match: 0.91,
    reason: 'Matched to your fingerprint',
    where: null,
    motif: 'spades',
    palette: ['#1B2A28', '#C7B8FF'],
    ...overrides,
  }
}

function explain(overrides: Partial<ExplainData> = {}): ExplainData {
  return {
    tmdb_id: '1396',
    title: 'Breaking Bad',
    explanation: 'Because you loved slow-burn character studies',
    reason_payload: {} as ExplainData['reason_payload'],
    is_stretch_pick: false,
    ...overrides,
  }
}

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('add / remove', () => {
  it('round-trips a saved card', () => {
    addToWatchlist(rec())
    expect(watchlistCount()).toBe(1)
    expect(isInWatchlist('movie:1396')).toBe(true)
    expect(getWatchlist()[0].rec.title).toBe('Breaking Bad')

    removeFromWatchlist('movie:1396')
    expect(watchlistCount()).toBe(0)
    expect(isInWatchlist('movie:1396')).toBe(false)
  })

  it('stores the full card so the view needs no refetch', () => {
    const saved = rec({ poster_url: 'https://img/p.jpg', is_stretch_pick: true, match: 0.42 })
    addToWatchlist(saved)
    expect(getWatchlist()[0].rec).toEqual(saved)
  })

  it('is idempotent — re-adding does not duplicate', () => {
    addToWatchlist(rec())
    addToWatchlist(rec())
    expect(watchlistCount()).toBe(1)
  })

  it('keeps the original entry (position + synced) when re-added', () => {
    addToWatchlist(rec({ id: 'movie:1' }))
    addToWatchlist(rec({ id: 'movie:2' }))
    markSynced(['movie:1'])

    addToWatchlist(rec({ id: 'movie:1' }))

    const list = getWatchlist()
    expect(list.map((e) => e.rec.id)).toEqual(['movie:2', 'movie:1'])
    expect(list.find((e) => e.rec.id === 'movie:1')!.synced).toBe(true)
  })

  it('removing an absent id is a harmless no-op', () => {
    addToWatchlist(rec())
    removeFromWatchlist('movie:9999')
    expect(watchlistCount()).toBe(1)
  })

  it('orders newest first', () => {
    addToWatchlist(rec({ id: 'movie:1' }))
    addToWatchlist(rec({ id: 'movie:2' }))
    addToWatchlist(rec({ id: 'movie:3' }))
    expect(getWatchlist().map((e) => e.rec.id)).toEqual(['movie:3', 'movie:2', 'movie:1'])
  })
})

describe('composite-id addressing', () => {
  // TMDB movie and TV ids collide (1396 is both Breaking Bad and a film).
  // Keying on a bare tmdb_id would collapse them — the bug fixed in PR #31.
  it('keeps a movie and a TV title that share a tmdb_id', () => {
    addToWatchlist(rec({ id: 'movie:1396', type: 'movie' }))
    addToWatchlist(rec({ id: 'tv:1396', type: 'tv' }))

    expect(watchlistCount()).toBe(2)
    expect(isInWatchlist('movie:1396')).toBe(true)
    expect(isInWatchlist('tv:1396')).toBe(true)
  })

  it('removes only the matching type on a colliding id', () => {
    addToWatchlist(rec({ id: 'movie:1396', type: 'movie' }))
    addToWatchlist(rec({ id: 'tv:1396', type: 'tv' }))

    removeFromWatchlist('movie:1396')

    expect(getWatchlist().map((e) => e.rec.id)).toEqual(['tv:1396'])
  })

  it('handles bare mock ids (no type prefix) alongside engine ids', () => {
    addToWatchlist(rec({ id: 'the-holdovers' }))
    addToWatchlist(rec({ id: 'movie:1396' }))

    expect(isInWatchlist('the-holdovers')).toBe(true)
    removeFromWatchlist('the-holdovers')
    expect(getWatchlist().map((e) => e.rec.id)).toEqual(['movie:1396'])
  })
})

describe('rating tags', () => {
  // Rating must NOT take a title off the watchlist — it stays, tagged, and only
  // removeFromWatchlist takes it off.
  it('keeps a rated title on the list, carrying its rating', () => {
    addToWatchlist(rec())
    setWatchlistRating('movie:1396', 'loved')

    expect(watchlistCount()).toBe(1)
    expect(getWatchlist()[0].rating).toBe('loved')
  })

  it('starts untagged', () => {
    addToWatchlist(rec())
    expect(getWatchlist()[0].rating).toBeNull()
  })

  it('records a removal as its own tag', () => {
    addToWatchlist(rec())
    setWatchlistRating('movie:1396', 'removed')
    expect(getWatchlist()[0].rating).toBe('removed')
  })

  it('overwrites an earlier tag', () => {
    addToWatchlist(rec())
    setWatchlistRating('movie:1396', 'liked')
    setWatchlistRating('movie:1396', 'disliked')
    expect(getWatchlist()[0].rating).toBe('disliked')
  })

  it('is a no-op for a title that was never saved', () => {
    setWatchlistRating('movie:1396', 'loved')
    expect(watchlistCount()).toBe(0)
  })

  it('tags only the matching type on a colliding id', () => {
    addToWatchlist(rec({ id: 'movie:1396', type: 'movie' }))
    addToWatchlist(rec({ id: 'tv:1396', type: 'tv' }))

    setWatchlistRating('tv:1396', 'loved')

    const byId = new Map(getWatchlist().map((e) => [e.rec.id, e.rating]))
    expect(byId.get('tv:1396')).toBe('loved')
    expect(byId.get('movie:1396')).toBeNull()
  })

  it('normalises entries stored before ratings existed', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ rec: rec(), added_at: 1, explain: null, synced: false }]),
    )
    expect(getWatchlist()[0].rating).toBeNull()
  })

  it('drops the tag when the title is re-added after removal', () => {
    addToWatchlist(rec())
    setWatchlistRating('movie:1396', 'loved')
    removeFromWatchlist('movie:1396')
    addToWatchlist(rec())

    expect(getWatchlist()[0].rating).toBeNull()
  })
})

describe('explain snapshot', () => {
  it('stores the breakdown captured at add time', () => {
    addToWatchlist(rec(), explain())
    expect(getWatchlist()[0].explain?.explanation).toBe(
      'Because you loved slow-burn character studies',
    )
  })

  it('defaults to null when no breakdown was cached', () => {
    addToWatchlist(rec())
    expect(getWatchlist()[0].explain).toBeNull()
  })

  it('backfills a missing snapshot on re-add', () => {
    addToWatchlist(rec())
    addToWatchlist(rec(), explain())
    expect(getWatchlist()[0].explain).not.toBeNull()
    expect(watchlistCount()).toBe(1)
  })

  it('does not overwrite an existing snapshot on re-add', () => {
    addToWatchlist(rec(), explain({ explanation: 'original' }))
    addToWatchlist(rec(), explain({ explanation: 'replacement' }))
    expect(getWatchlist()[0].explain?.explanation).toBe('original')
  })
})

describe('sync bookkeeping', () => {
  it('reports newly saved ids as unsynced', () => {
    addToWatchlist(rec({ id: 'movie:1' }))
    addToWatchlist(rec({ id: 'movie:2' }))
    expect(getUnsyncedIds().sort()).toEqual(['movie:1', 'movie:2'])
  })

  it('drops ids from the unsynced set once marked', () => {
    addToWatchlist(rec({ id: 'movie:1' }))
    addToWatchlist(rec({ id: 'movie:2' }))

    markSynced(['movie:1'])

    expect(getUnsyncedIds()).toEqual(['movie:2'])
    expect(getWatchlist().find((e) => e.rec.id === 'movie:1')!.synced).toBe(true)
  })

  it('ignores unknown ids and an empty list', () => {
    addToWatchlist(rec({ id: 'movie:1' }))
    markSynced([])
    markSynced(['movie:404'])
    expect(getUnsyncedIds()).toEqual(['movie:1'])
  })

  it('re-marking an already-synced id is a no-op', () => {
    addToWatchlist(rec({ id: 'movie:1' }))
    markSynced(['movie:1'])
    markSynced(['movie:1'])
    expect(getUnsyncedIds()).toEqual([])
  })
})

describe('storage cap', () => {
  it('evicts the oldest entries past 200', () => {
    for (let i = 1; i <= 201; i++) addToWatchlist(rec({ id: `movie:${i}` }))

    const list = getWatchlist()
    expect(list).toHaveLength(200)
    expect(list[0].rec.id).toBe('movie:201') // newest kept
    expect(isInWatchlist('movie:1')).toBe(false) // oldest evicted
    expect(isInWatchlist('movie:2')).toBe(true)
  })
})

describe('hostile storage', () => {
  it('reads corrupt JSON as an empty list', () => {
    window.localStorage.setItem(STORAGE_KEY, '{not json')
    expect(getWatchlist()).toEqual([])
    expect(watchlistCount()).toBe(0)
  })

  it('reads a non-array payload as an empty list', () => {
    window.localStorage.setItem(STORAGE_KEY, '{"nope":true}')
    expect(getWatchlist()).toEqual([])
  })

  it('skips entries with no addressable id', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { rec: { title: 'no id' }, added_at: 1, explain: null, synced: false },
        { rec: rec({ id: 'movie:7' }), added_at: 2, explain: null, synced: false },
      ]),
    )
    expect(getWatchlist().map((e) => e.rec.id)).toEqual(['movie:7'])
  })

  it('does not throw when the quota is exceeded', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })

    expect(() => addToWatchlist(rec())).not.toThrow()
    expect(() => removeFromWatchlist('movie:1396')).not.toThrow()
    expect(() => markSynced(['movie:1396'])).not.toThrow()
  })

  it('is inert during SSR (no window)', () => {
    vi.stubGlobal('window', undefined)

    expect(getWatchlist()).toEqual([])
    expect(isInWatchlist('movie:1396')).toBe(false)
    expect(watchlistCount()).toBe(0)
    expect(getUnsyncedIds()).toEqual([])
    expect(() => addToWatchlist(rec())).not.toThrow()

    vi.unstubAllGlobals()
    expect(watchlistCount()).toBe(0) // the SSR write was a no-op, not a crash
  })
})
