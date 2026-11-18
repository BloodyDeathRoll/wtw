import { describe, it, expect } from 'vitest'
import {
  orderWatchlist,
  filterWatchlist,
  watchlistChips,
  emptyFilterText,
  isSeen,
  MAX_SERVICE_CHIPS,
} from '@/modules/session/recommendations/watchlist-order'
import { ISRAEL_SERVICES } from '@/lib/watch-providers'
import type { WatchlistEntry } from '@/lib/watchlist'
import type { Recommendation } from '@/types/recommendation'

// The Watchlist's order and chips (docs/plan/v3/WATCHLIST.md DEC-3 to DEC-7):
// starred on top, then newest saved first, rated titles under a Seen line at
// the end; one chip per part of the list, All counting everything.

function entry(id: string, o: Partial<WatchlistEntry> & { type?: Recommendation['type']; where_il?: string | null } = {}): WatchlistEntry {
  const { type = 'movie', where_il, ...rest } = o
  return {
    rec: {
      id, title: id, type, year: 2008, poster_url: null, meta: '1h 45m', rating: 8, match: 0.9,
      reason: '', where: null, motif: 'spades', palette: ['#000', '#fff'],
      ...(where_il === undefined ? {} : { where_il }),
    },
    added_at: 1,
    rating: null,
    starred: false,
    explain: null,
    synced: true,
    ...rest,
  }
}

const LIST = [
  entry('old', { added_at: 1 }),
  entry('loved-old', { added_at: 2, rating: 'loved', where_il: 'Netflix' }),
  entry('starred-old', { added_at: 3, starred: true }),
  entry('new', { added_at: 4, type: 'tv', where_il: 'Netflix' }),
  entry('liked-new', { added_at: 5, rating: 'liked', type: 'tv' }),
  entry('starred-new', { added_at: 6, starred: true, where_il: 'Apple TV' }),
  entry('removed-tag', { added_at: 7, rating: 'removed' }),
]

describe('orderWatchlist', () => {
  it('starred first, then the rest newest-saved first, then the rated ones', () => {
    const { unseen, seen } = orderWatchlist(LIST)
    expect(unseen.map((e) => e.rec.id)).toEqual(['starred-new', 'starred-old', 'removed-tag', 'new', 'old'])
    expect(seen.map((e) => e.rec.id)).toEqual(['liked-new', 'loved-old'])
  })

  it('a rated title sinks under Seen even when starred; the old X tag is not a rating', () => {
    const { unseen, seen } = orderWatchlist([entry('a', { rating: 'disliked', starred: true }), entry('b', { rating: 'removed' })])
    expect(seen.map((e) => e.rec.id)).toEqual(['a'])
    expect(unseen.map((e) => e.rec.id)).toEqual(['b'])
    expect(isSeen(entry('b', { rating: 'removed' }))).toBe(false)
  })

  it('does not change the input', () => {
    const list = [...LIST]
    orderWatchlist(list)
    expect(list.map((e) => e.rec.id)).toEqual(LIST.map((e) => e.rec.id))
  })
})

describe('watchlistChips', () => {
  it('All · Starred · Movies · Series · services with a title · Seen, with counts', () => {
    expect(watchlistChips(LIST).map((c) => [c.label, c.count])).toEqual([
      ['All', 7], ['Starred', 2], ['Movies', 5], ['Series', 2], ['Netflix', 2], ['Apple TV', 1], ['Seen', 2],
    ])
  })

  it('All and the parts keep counting rated titles (DEC-6)', () => {
    const chips = watchlistChips(LIST)
    expect(chips.find((c) => c.label === 'All')!.count).toBe(LIST.length)
    expect(chips.find((c) => c.label === 'Netflix')!.count).toBe(2) // one of them is loved
  })

  it('a service chip only while a title is on it; Movies, Series and Seen always', () => {
    expect(watchlistChips([entry('a')]).map((c) => c.label)).toEqual(['All', 'Starred', 'Movies', 'Series', 'Seen'])
    expect(watchlistChips([]).map((c) => c.label)).toEqual(['All', 'Starred', 'Movies', 'Series', 'Seen'])
  })

  it('services are chips only while the region has at most MAX_SERVICE_CHIPS of them (Israel: four)', () => {
    expect(MAX_SERVICE_CHIPS).toBe(5)
    expect(ISRAEL_SERVICES.length).toBeLessThanOrEqual(MAX_SERVICE_CHIPS)
  })

  it('services in the fixed order, never more than four', () => {
    const list = [entry('p', { where_il: 'Prime Video' }), entry('h', { where_il: 'HBO Max' }), entry('n', { where_il: 'Netflix' }), entry('a', { where_il: 'Apple TV' })]
    expect(watchlistChips(list).map((c) => c.label)).toEqual(['All', 'Starred', 'Movies', 'Series', 'Netflix', 'HBO Max', 'Apple TV', 'Prime Video', 'Seen'])
  })
})

describe('filterWatchlist', () => {
  it('each chip shows its part; a title not yet looked up is on no service', () => {
    const ids = (f: Parameters<typeof filterWatchlist>[1]) => filterWatchlist(LIST, f).map((e) => e.rec.id)
    expect(ids('all')).toHaveLength(7)
    expect(ids('starred')).toEqual(['starred-old', 'starred-new'])
    expect(ids('series')).toEqual(['new', 'liked-new'])
    expect(ids('service:Netflix')).toEqual(['loved-old', 'new'])
    expect(ids('service:Prime Video')).toEqual([])
    expect(ids('seen')).toEqual(['loved-old', 'liked-new'])
  })
})

describe('emptyFilterText', () => {
  it('says what is missing, true to the facts', () => {
    expect(emptyFilterText('starred')).toBe('Nothing starred yet. Star a title and it stays at the top of your list.')
    expect(emptyFilterText('service:Netflix')).toBe('Nothing on Netflix on your list.')
    expect(emptyFilterText('all')).toMatch(/^Nothing saved yet\./)
  })
})
