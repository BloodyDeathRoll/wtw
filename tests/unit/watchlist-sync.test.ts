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

describe('rejected and long queues', () => {
  beforeEach(async () => {
    fakeServer([])
    await hydrateWatchlist('user-a')
  })

  it('drops a change the server rejects instead of retrying it forever', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad', { status: 400 })))
    addToWatchlist(rec('movie:1'))
    await settle()

    const server = fakeServer([])
    addToWatchlist(rec('movie:2'))
    await settle()
    const posted = server.calls.filter((c) => c.method === 'POST')
    expect(posted.flatMap((c) => c.body!.upsert.map((e) => e.rec.id))).toEqual(['movie:2'])
  })

  it('sends more than 200 queued changes in successive pushes', async () => {
    fakeServer([], { fail: true })
    for (let i = 0; i < 250; i++) {
      addToWatchlist(rec(`movie:${i}`))
      removeFromWatchlist(`movie:${i}`)
    }
    await settle()

    const server = fakeServer([])
    await hydrateWatchlist('user-a')
    const posted = server.calls.filter((c) => c.method === 'POST')
    expect(posted.length).toBeGreaterThanOrEqual(2)
    expect(posted.every((c) => c.body!.delete.length <= 200)).toBe(true)
    expect(posted.reduce((n, c) => n + c.body!.delete.length, 0)).toBe(250)
  })
})

describe('partial and oversized rejections', () => {
  beforeEach(async () => {
    fakeServer([])
    await hydrateWatchlist('user-a')
  })

  it('treats 413 like 400 — dropped, not retried', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('too big', { status: 413 })))
    addToWatchlist(rec('movie:1'))
    await settle()

    const server = fakeServer([])
    await hydrateWatchlist('user-a')
    expect(server.calls.filter((c) => c.method === 'POST')).toHaveLength(0)
  })

  it('cuts pushes by size as well as count', async () => {
    fakeServer([], { fail: true })
    const big = 'x'.repeat(30_000)
    for (let i = 0; i < 50; i++) addToWatchlist({ ...rec(`movie:${i}`), reason: big })
    await settle()

    const server = fakeServer([])
    await hydrateWatchlist('user-a')
    const posted = server.calls.filter((c) => c.method === 'POST')
    expect(posted.length).toBeGreaterThanOrEqual(2)
    expect(posted.every((c) => JSON.stringify(c.body).length < 1_100_000)).toBe(true)
    expect(server.entries()).toHaveLength(50)
  })
})

describe('isolating a bad change', () => {
  beforeEach(async () => {
    fakeServer([])
    await hydrateWatchlist('user-a')
  })

  it('splits a refused batch until the bad change is dropped alone', async () => {
    fakeServer([], { fail: true })
    for (let i = 0; i < 6; i++) addToWatchlist(rec(`movie:${i}`))
    await settle()

    // A server that refuses any batch carrying movie:3.
    let stored: string[] = []
    const batches: string[][] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init?: RequestInit) => {
        const body = init?.body ? JSON.parse(init.body as string) : null
        const ids: string[] = body ? body.upsert.map((e: { rec: { id: string } }) => e.rec.id) : []
        if (body) batches.push(ids)
        if (ids.includes('movie:3')) return new Response('bad', { status: 400 })
        stored = [...new Set([...stored, ...ids])]
        return Response.json({ entries: stored.map((id) => wire(id, 1)), rejected: [] })
      }),
    )
    await hydrateWatchlist('user-a')
    expect(stored.sort()).toEqual(['movie:0', 'movie:1', 'movie:2', 'movie:4', 'movie:5'])
    // Full batch, then the refused half, then alone — never re-bundled after.
    expect(batches.filter((b) => b.includes('movie:3')).map((b) => b.length)).toEqual([6, 3, 1])
    expect(window.localStorage.getItem('wtw_watchlist_pending')).toBeNull()
  })

  it('drops only the changes the server names as rejected', async () => {
    fakeServer([], { fail: true })
    addToWatchlist(rec('movie:1'))
    addToWatchlist(rec('movie:2'))
    await settle()

    let posts = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init?: RequestInit) => {
        if (init?.method === 'POST') posts++
        return Response.json({ entries: [wire('movie:2', 1)], rejected: ['movie:1'] })
      }),
    )
    await hydrateWatchlist('user-a')
    await hydrateWatchlist('user-a')
    expect(posts).toBe(1)
  })
})
