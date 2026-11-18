import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  restoreToWatchlist,
  setWatchlistRating,
  setWatchlistStarred,
  getUnsyncedRemovals,
  hydrateWatchlist,
  markSynced,
} from '@/lib/watchlist'
import { toRow } from '@/app/api/watchlist/store'
import type { Recommendation } from '@/types/recommendation'

// A star to prioritise (docs/plan/v3/WATCHLIST.md DEC-4, migration 0034) and
// the Undo that puts a removed title back as it was (DEC-8). Like `rating`,
// the star lands in the cache at once and rides to /api/watchlist after.

function rec(id: string): Recommendation {
  return {
    id, title: `Title ${id}`, type: 'movie', year: 2008, poster_url: null, meta: '1h 45m',
    rating: 8.9, match: 0.91, reason: '', where: null, motif: 'spades', palette: ['#1B2A28', '#C7B8FF'],
  }
}

type Sent = { upsert: { rec: { id: string }; starred?: boolean; rating?: string | null }[]; delete: string[] }

function fakeServer(server: Record<string, unknown>[] = []) {
  const sent: Sent[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(init.body as string) as Sent) : null
    if (body) {
      sent.push(body)
      for (const id of body.delete) server = server.filter((e) => (e.rec as { id: string }).id !== id)
      for (const e of body.upsert) server = [...server.filter((s) => (s.rec as { id: string }).id !== e.rec.id), e]
    }
    return Response.json({ entries: server })
  }))
  return { sent, entries: () => server }
}

const settle = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  window.localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ entries: [] })))
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('setWatchlistStarred', () => {
  it('stars and un-stars a saved title in the cache at once', () => {
    addToWatchlist(rec('movie:1'))
    expect(getWatchlist()[0].starred).toBe(false)
    setWatchlistStarred('movie:1', true)
    expect(getWatchlist()[0].starred).toBe(true)
    setWatchlistStarred('movie:1', false)
    expect(getWatchlist()[0].starred).toBe(false)
  })

  it('is a no-op for a title that is not saved', () => {
    setWatchlistStarred('movie:9', true)
    expect(getWatchlist()).toEqual([])
  })

  it('an entry from before the star reads as not starred', () => {
    window.localStorage.setItem('wtw_watchlist', JSON.stringify([{ rec: rec('movie:1'), added_at: 1, rating: null, explain: null, synced: true }]))
    expect(getWatchlist()[0].starred).toBe(false)
  })

  it('reaches the server with the entry', async () => {
    const server = fakeServer()
    addToWatchlist(rec('movie:1'))
    await settle()
    setWatchlistStarred('movie:1', true)
    await settle()
    const last = server.sent.at(-1)!
    expect(last.upsert[0]).toMatchObject({ rec: { id: 'movie:1' }, starred: true })
  })

  it('hydrate takes the star from the server; a server without it means not starred', async () => {
    fakeServer([
      { rec: rec('movie:1'), explain: null, rating: null, starred: true, added_at: 2 },
      { rec: rec('movie:2'), explain: null, rating: null, added_at: 1 },
    ])
    window.localStorage.setItem('wtw_watchlist_owner', 'u1')
    await hydrateWatchlist('u1')
    const byId = Object.fromEntries(getWatchlist().map((e) => [e.rec.id, e.starred]))
    expect(byId).toEqual({ 'movie:1': true, 'movie:2': false })
  })
})

describe('restoreToWatchlist (Undo)', () => {
  it('puts the entry back as it was: place, rating, star, breakdown', () => {
    // Three saves a millisecond apart, so the place is unambiguous.
    const now = vi.spyOn(Date, 'now')
    now.mockReturnValue(1000); addToWatchlist(rec('movie:1'))
    now.mockReturnValue(2000); addToWatchlist(rec('movie:2'))
    now.mockReturnValue(3000); addToWatchlist(rec('movie:3'))
    now.mockRestore()
    setWatchlistStarred('movie:2', true)
    setWatchlistRating('movie:2', 'loved')
    markSynced(['movie:2'])
    const gone = getWatchlist().find((e) => e.rec.id === 'movie:2')!

    removeFromWatchlist('movie:2')
    expect(getWatchlist().map((e) => e.rec.id)).toEqual(['movie:3', 'movie:1'])
    expect(getUnsyncedRemovals()).toEqual(['movie:2'])

    restoreToWatchlist(gone)
    const list = getWatchlist()
    expect(list.map((e) => e.rec.id)).toEqual(['movie:3', 'movie:2', 'movie:1'])
    expect(list[1]).toMatchObject({ starred: true, rating: 'loved', synced: true, added_at: gone.added_at })
    // The fingerprint never hears of the removal.
    expect(getUnsyncedRemovals()).toEqual([])
  })

  it('does nothing when the title is on the list already', () => {
    addToWatchlist(rec('movie:1'))
    const e = getWatchlist()[0]
    restoreToWatchlist({ ...e, starred: true })
    expect(getWatchlist()).toHaveLength(1)
    expect(getWatchlist()[0].starred).toBe(false)
  })

  it('tells the server', async () => {
    const server = fakeServer()
    addToWatchlist(rec('movie:1'))
    await settle()
    const e = getWatchlist()[0]
    removeFromWatchlist('movie:1')
    await settle()
    restoreToWatchlist(e)
    await settle()
    expect(server.entries().map((s) => (s.rec as { id: string }).id)).toEqual(['movie:1'])
  })
})

describe('/api/watchlist rows', () => {
  it('stores the star, and reads a missing one as false', () => {
    const base = { rec: rec('movie:1'), explain: null, rating: null, added_at: 1 }
    expect(toRow('u1', { ...base, starred: true })!.starred).toBe(true)
    expect(toRow('u1', base)!.starred).toBe(false)
    expect(toRow('u1', { ...base, starred: 'yes' })).toBeNull()
  })
})
