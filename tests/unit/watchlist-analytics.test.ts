import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Recommendation } from '@/types/recommendation'

// GA4 (#464): the watchlist reports each real add and remove with the list's
// size after it; a re-save and removing a title that isn't there report nothing.

const track = vi.fn()
vi.mock('@/lib/analytics', () => ({ track: (...a: unknown[]) => track(...a) }))
const { addToWatchlist, removeFromWatchlist } = await import('@/lib/watchlist')

const rec = (id: string, type: 'movie' | 'tv' = 'movie') =>
  ({ id, title: id, type, year: 2000, poster_url: null, meta: '', rating: 7, match: 0.8, reason: '', where: null, motif: 'spades', palette: ['#000', '#fff'] }) as unknown as Recommendation

beforeEach(() => { localStorage.clear(); track.mockClear() })

describe('watchlist analytics', () => {
  it('reports adds with the new size, and the first one as items = 1', () => {
    addToWatchlist(rec('movie:1'))
    addToWatchlist(rec('tv:2', 'tv'))
    expect(track.mock.calls).toEqual([
      ['watchlist_add', { items: 1, type: 'movie' }],
      ['watchlist_add', { items: 2, type: 'tv' }],
    ])
  })

  it('a re-save of a title already there reports nothing', () => {
    addToWatchlist(rec('movie:1'))
    track.mockClear()
    addToWatchlist(rec('movie:1'))
    expect(track).not.toHaveBeenCalled()
  })

  it('reports a remove with the size left; a missing title reports nothing', () => {
    addToWatchlist(rec('movie:1'))
    addToWatchlist(rec('movie:2'))
    track.mockClear()
    removeFromWatchlist('movie:1')
    removeFromWatchlist('movie:9')
    expect(track.mock.calls).toEqual([['watchlist_remove', { items: 1 }]])
  })
})
