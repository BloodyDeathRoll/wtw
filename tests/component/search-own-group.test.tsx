/**
 * Your own group in Search ("In Seen", "In your Watchlist"): its rows read like every other result, the year line
 * once and then the actors (Eran on #388; it used to show the year twice, or none in Seen).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

let params = new URLSearchParams('in=ratings')
vi.mock('@/lib/flags', async (orig) => ({ ...(await orig<typeof import('@/lib/flags')>()), searchV3Enabled: () => true }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => params,
}))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { signOut: vi.fn() } }) }))
vi.mock('@/lib/watchlist', async (orig) => ({ ...(await orig<typeof import('@/lib/watchlist')>()), hydrateWatchlist: vi.fn(async () => {}) }))

import SearchView from '@/app/search/SearchView'

const user = { id: 'u1', email: null, name: 'E', avatarUrl: null }
const castCalls: string[] = []

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  castCalls.length = 0
})

describe('Search: your own group', () => {
  it('In Seen: the year once on the year line, the actors on the third', async () => {
    params = new URLSearchParams('in=ratings')
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.startsWith('/api/recommendations/ratings')) {
        return Response.json({
          counts: { loved: 1, liked: 0, disliked: 0, removed: 0 },
          items: [{ id: 'movie:77', title: 'Memento', rating: 'loved', created_at: '2026-11-19T00:00:00Z', tmdb_id: '77', media_type: 'movie', poster_url: null, year: 2000, meta: null, star: null }],
          removed: [],
        })
      }
      if (url.startsWith('/api/search/cast')) {
        castCalls.push(url)
        return Response.json({ cast: url.includes('movie-77') ? { 'movie-77': 'Guy Pearce, Carrie-Anne Moss' } : {} })
      }
      if (url.startsWith('/api/search')) return Response.json({ results: [] })
      return Response.json({})
    }))
    render(<SearchView user={user} />)
    // Seen's list arrives, then the search.
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([u]) => String(u).startsWith('/api/recommendations/ratings'))).toBe(true))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search titles and people' }), { target: { value: 'memento' } })
    const group = await screen.findByRole('listbox', { name: 'Seen' })
    const row = within(group).getByRole('option', { name: /Memento/ })
    const yearLine = row.querySelector('b')!.nextElementSibling!
    await waitFor(() => expect(yearLine.nextElementSibling!.textContent).toBe('Guy Pearce, Carrie-Anne Moss'))
    expect(yearLine.textContent).toMatch(/^2000( · |$)/)
    expect(row.textContent!.match(/2000/g)).toHaveLength(1)
    expect(castCalls.some((u) => u.includes('movie-77'))).toBe(true)
  })

  it('more than 8 of your titles: their actors are asked 8 at a time, and a title already in the results only once', async () => {
    params = new URLSearchParams('in=ratings')
    const items = Array.from({ length: 10 }, (_, i) => ({ id: `movie:${100 + i}`, title: `The Film ${i}`, rating: 'liked', created_at: '2026-11-19T00:00:00Z', tmdb_id: String(100 + i), media_type: 'movie', poster_url: null, year: 2000 + i, meta: null, star: null }))
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.startsWith('/api/recommendations/ratings')) return Response.json({ counts: { loved: 0, liked: 10, disliked: 0, removed: 0 }, items, removed: [] })
      if (url.startsWith('/api/search/cast')) { castCalls.push(url); return Response.json({ cast: {} }) }
      if (url.startsWith('/api/search')) return Response.json({ results: [{ type: 'movie', tmdb_id: '100', title: 'The Film 0', year: 2000, poster_path: null }] })
      return Response.json({})
    }))
    render(<SearchView user={user} />)
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([u]) => String(u).startsWith('/api/recommendations/ratings'))).toBe(true))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search titles and people' }), { target: { value: 'the film' } })
    await waitFor(() => expect(castCalls).toHaveLength(3))
    const keys = castCalls.map((u) => decodeURIComponent(u.split('keys=')[1]).split(','))
    for (const k of keys) expect(k.length).toBeLessThanOrEqual(8)
    const all = keys.flat()
    expect(all.filter((k) => k === 'movie-100')).toHaveLength(1)
    expect(new Set(all).size).toBe(10)
  })
})
