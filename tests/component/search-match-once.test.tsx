/**
 * Search asks for your matches only once the results hold still, and keeps them for the visit (#375: the score
 * route was ~70% of Active CPU, asked again for every list while you typed).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('@/lib/flags', async (orig) => ({ ...(await orig<typeof import('@/lib/flags')>()), searchV3Enabled: () => true }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { signOut: vi.fn() } }) }))
vi.mock('@/lib/watchlist', async (orig) => ({ ...(await orig<typeof import('@/lib/watchlist')>()), hydrateWatchlist: vi.fn(async () => {}) }))

import SearchView from '@/app/search/SearchView'

const user = { id: 'u-match', email: null, name: 'E', avatarUrl: null }
const scoreCalls: string[][] = []
const RESULTS: Record<string, { type: 'movie'; tmdb_id: string; title: string; year: number; poster_path: null }[]> = {
  sl: [{ type: 'movie', tmdb_id: '1', title: 'Sleepers', year: 1996, poster_path: null }],
  slo: [{ type: 'movie', tmdb_id: '2', title: 'Slow West', year: 2015, poster_path: null }],
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  scoreCalls.length = 0
})

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/recommendations/score') {
      const { titles } = JSON.parse(String(init?.body)) as { titles: { type: string; tmdb_id: string }[] }
      scoreCalls.push(titles.map((t) => `${t.type}:${t.tmdb_id}`))
      return Response.json({ matches: Object.fromEntries(titles.map((t) => [`${t.type}:${t.tmdb_id}`, 0.87])) })
    }
    if (url.startsWith('/api/search/cast')) return Response.json({ cast: {} })
    if (url.startsWith('/api/search')) return Response.json({ results: RESULTS[new URL(url, 'http://x').searchParams.get('q')!] ?? [] })
    return Response.json({})
  }))
}

describe('Search: matches asked once', () => {
  it('typing on asks only for the list you stop at, and a second open of Search asks nothing again', async () => {
    // Fake timers: the search's 250 ms wait and the 600 ms match pause run exactly, however busy the machine is.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    stubFetch()
    const wait = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))
    render(<SearchView user={user} />)
    const box = screen.getByRole('searchbox', { name: 'Search titles and people' })
    // "sl" lands and stays up 300 ms: the next letter comes before the match pause ends.
    fireEvent.change(box, { target: { value: 'sl' } })
    await wait(250)
    expect(screen.getByRole('option', { name: /Sleepers/ })).toBeInTheDocument()
    await wait(300)
    fireEvent.change(box, { target: { value: 'slo' } })
    await wait(250)
    expect(screen.getByRole('option', { name: /Slow West/ })).toBeInTheDocument()
    expect(scoreCalls).toEqual([])
    await wait(700)
    expect(scoreCalls).toEqual([['movie:2']])
    expect(screen.getByText(/87%/)).toBeInTheDocument()

    // Search again later in the same visit: the match shows from memory, with no new call.
    cleanup()
    render(<SearchView user={user} />)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search titles and people' }), { target: { value: 'slo' } })
    await wait(1000)
    expect(screen.getByText(/87%/)).toBeInTheDocument()
    expect(scoreCalls).toEqual([['movie:2']])
  })
})
