import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  setWatchlistRating,
  getUnsyncedRemovals,
  hydrateWatchlist,
  WATCHLIST_HYDRATED_EVENT,
} from '@/lib/watchlist'
import type { Recommendation } from '@/types/recommendation'

// Server sync: localStorage is a cache of /api/watchlist. These pin the
// one-time upload of a device's existing list, the server winning on load,
// and queued changes surviving a failed push.

function rec(id: string): Recommendation {
  return {
    id,
    title: `Title ${id}`,
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
  }
}

function wire(id: string, added_at: number, rating: string | null = null) {
  return { rec: rec(id), explain: null, rating, added_at }
}

type Call = { method: string; body: { upsert: { rec: { id: string } }[]; delete: string[] } | null }

/** A fake /api/watchlist holding `server`, recording every call. */
function fakeServer(server: ReturnType<typeof wire>[], opts: { fail?: boolean } = {}) {
  const calls: Call[] = []
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(init.body as string) : null
    calls.push({ method, body })
    if (opts.fail) return new Response('nope', { status: 500 })
    if (body) {
      for (const id of body.delete) server = server.filter((e) => e.rec.id !== id)
      for (const e of body.upsert) {
        server = [...server.filter((s) => s.rec.id !== e.rec.id), e]
      }
    }
    return Response.json({ entries: [...server].sort((a, b) => b.added_at - a.added_at) })
  })
  vi.stubGlobal('fetch', fetchMock)
  return { calls, entries: () => server }
}

/** Let fire-and-forget pushes settle. */
async function settle() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
}

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(async () => {
  await settle()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('first load on a device', () => {
  it('uploads the local list and merges it with the account', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })))
    addToWatchlist(rec('movie:1'))
    await settle()

    const server = fakeServer([wire('movie:2', 1)])
    await hydrateWatchlist('user-a')

    expect(server.entries().map((e) => e.rec.id).sort()).toEqual(['movie:1', 'movie:2'])
    expect(getWatchlist().map((e) => e.rec.id).sort()).toEqual(['movie:1', 'movie:2'])
  })

  it('uploads only once', async () => {
    const server = fakeServer([])
    await hydrateWatchlist('user-a')
    await hydrateWatchlist('user-a')
    expect(server.calls.filter((c) => c.method === 'POST')).toHaveLength(0)
  })
})

describe('later loads', () => {
  it('drops what another device removed', async () => {
    fakeServer([wire('movie:1', 1)])
    await hydrateWatchlist('user-a')
    expect(getWatchlist()).toHaveLength(1)

    fakeServer([])
    await hydrateWatchlist('user-a')
    expect(getWatchlist()).toHaveLength(0)
  })

  it('takes ratings set on another device', async () => {
    fakeServer([wire('movie:1', 1)])
    await hydrateWatchlist('user-a')

    fakeServer([wire('movie:1', 1, 'loved')])
    await hydrateWatchlist('user-a')
    expect(getWatchlist()[0].rating).toBe('loved')
  })

  it('treats titles saved elsewhere as already reported, keeps local flags', async () => {
    fakeServer([])
    await hydrateWatchlist('user-a')
    addToWatchlist(rec('movie:1'))
    await settle()

    fakeServer([wire('movie:1', 1), wire('movie:2', 2)])
    await hydrateWatchlist('user-a')
    const byId = Object.fromEntries(getWatchlist().map((e) => [e.rec.id, e.synced]))
    expect(byId).toEqual({ 'movie:1': false, 'movie:2': true })
  })

  it('discards a cache that belongs to another user', async () => {
    fakeServer([wire('movie:1', 1)])
    await hydrateWatchlist('user-a')
    removeFromWatchlist('movie:1')
    await settle()

    const server = fakeServer([wire('movie:9', 1)])
    await hydrateWatchlist('user-b')
    expect(getWatchlist().map((e) => e.rec.id)).toEqual(['movie:9'])
    expect(server.calls.every((c) => c.method === 'GET')).toBe(true)
    expect(getUnsyncedRemovals()).toEqual([])
  })

  it('announces the refreshed cache', async () => {
    fakeServer([])
    const heard = vi.fn()
    window.addEventListener(WATCHLIST_HYDRATED_EVENT, heard)
    await hydrateWatchlist('user-a')
    window.removeEventListener(WATCHLIST_HYDRATED_EVENT, heard)
    expect(heard).toHaveBeenCalledOnce()
  })

  it('leaves the cache alone when the server is unreachable', async () => {
    fakeServer([])
    await hydrateWatchlist('user-a')
    addToWatchlist(rec('movie:1'))
    await settle()

    fakeServer([], { fail: true })
    await hydrateWatchlist('user-a')
    expect(getWatchlist().map((e) => e.rec.id)).toEqual(['movie:1'])
  })
})

describe('changes', () => {
  beforeEach(async () => {
    fakeServer([])
    await hydrateWatchlist('user-a')
  })

  it('pushes saves, ratings and removals', async () => {
    const server = fakeServer([])
    addToWatchlist(rec('movie:1'))
    await settle()
    expect(server.entries().map((e) => e.rec.id)).toEqual(['movie:1'])

    setWatchlistRating('movie:1', 'liked')
    await settle()
    expect(server.entries()[0].rating).toBe('liked')

    removeFromWatchlist('movie:1')
    await settle()
    expect(server.entries()).toEqual([])
  })

  it('keeps a failed change queued and sends it on the next load', async () => {
    fakeServer([], { fail: true })
    addToWatchlist(rec('movie:1'))
    await settle()

    const server = fakeServer([])
    await hydrateWatchlist('user-a')
    expect(server.entries().map((e) => e.rec.id)).toEqual(['movie:1'])
    expect(getWatchlist().map((e) => e.rec.id)).toEqual(['movie:1'])
  })

  it('a removal queued while offline beats the server copy', async () => {
    fakeServer([], { fail: true })
    addToWatchlist(rec('movie:1'))
    await settle()
    removeFromWatchlist('movie:1')
    await settle()

    const server = fakeServer([wire('movie:1', 1)])
    await hydrateWatchlist('user-a')
    expect(server.entries()).toEqual([])
    expect(getWatchlist()).toEqual([])
  })
})
