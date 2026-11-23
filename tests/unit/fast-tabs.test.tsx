import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'

// v3 F8 (FAST_TABS; docs/plan/v3/PLAN.md §4 F8): Games and You are kept and fetched ahead, a write refreshes what's
// kept, and the loading cover waits a moment so a kept screen shows without the spinning logo. Flag off: today.

const router = { push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }
vi.mock('next/navigation', () => ({ useRouter: () => router }))

import { TabBar, TAB_HREF, tabsToFetchAhead, COVER_AFTER_MS } from '@/app/components/TabBar'
import { fastTabsEnabled } from '@/lib/flags'
import { tabsChanged, tabsStale, refreshIfStale, resetFastTabsForTests, PREFETCH_AFTER_MS } from '@/lib/fast-tabs'
import { announceHidden, announceRated } from '@/modules/session/recommendations/rate'
import { addToWatchlist } from '@/lib/watchlist'

const user = { id: 'u1', email: null, name: 'Solomon', avatarUrl: null }

beforeEach(() => {
  localStorage.clear()
  Object.values(router).forEach((f) => f.mockClear())
  resetFastTabsForTests()
  vi.useFakeTimers()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  delete process.env.FAST_TABS
  window.history.replaceState(null, '', '/')
})

describe('the switch', () => {
  it('is off unless FAST_TABS is on', () => {
    expect(fastTabsEnabled()).toBe(false)
    process.env.FAST_TABS = 'true'
    expect(fastTabsEnabled()).toBe(true)
  })
  it('reaches the client, and the router keeps pages only with it on (next.config)', () => {
    const cfg = readFileSync('next.config.ts', 'utf8')
    expect(cfg).toMatch(/FAST_TABS: process\.env\.FAST_TABS \?\? ""/)
    expect(cfg).toMatch(/fastTabsEnabled\(\) \? \{ experimental: \{ staleTimes: \{ dynamic: 300 \} \} \} : \{\}/)
  })
})

describe('what each screen fetches ahead', () => {
  it('from the home route, Games and You', () => {
    expect(tabsToFetchAhead('foryou', true, true)).toEqual([TAB_HREF.games, TAB_HREF.you])
    expect(tabsToFetchAhead('watchlist', true, true)).toEqual([TAB_HREF.games, TAB_HREF.you])
  })
  it('from Games or You, the other three; from an inner page, all four', () => {
    expect(tabsToFetchAhead('games', true, false)).toEqual([TAB_HREF.foryou, TAB_HREF.watchlist, TAB_HREF.you])
    expect(tabsToFetchAhead('you', false, false)).toEqual(Object.values(TAB_HREF))
  })
})

describe('TabBar, flag off: today', () => {
  it('fetches nothing ahead, covers the screen at once, and never refreshes', () => {
    render(<TabBar active="foryou" user={user} />)
    act(() => { vi.advanceTimersByTime(10_000) })
    expect(router.prefetch).not.toHaveBeenCalled()
    tabsChanged()
    fireEvent.click(screen.getByRole('button', { name: 'You' }))
    expect(screen.getByText('Loading')).toBeTruthy()
    expect(router.refresh).not.toHaveBeenCalled()
    expect(router.push).toHaveBeenCalledWith(TAB_HREF.you)
  })
})

describe('TabBar, FAST_TABS on', () => {
  beforeEach(() => { process.env.FAST_TABS = 'true' })

  it('fetches the other tabs whole once the app is idle, and again when the router drops them', () => {
    render(<TabBar active="games" user={user} />)
    expect(router.prefetch).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(PREFETCH_AFTER_MS + 3000) })
    const hrefs = router.prefetch.mock.calls.map(([h]) => h)
    expect(hrefs).toEqual([TAB_HREF.foryou, TAB_HREF.watchlist, TAB_HREF.you])
    expect(router.prefetch.mock.calls[0][1].kind).toBe('full')
    act(() => { router.prefetch.mock.calls[2][1].onInvalidate() })
    act(() => { vi.advanceTimersByTime(PREFETCH_AFTER_MS + 3000) })
    expect(router.prefetch).toHaveBeenCalledTimes(4)
    expect(router.prefetch.mock.calls[3][0]).toBe(TAB_HREF.you)
  })

  it('a screen that has closed never fetches again', () => {
    const { unmount } = render(<TabBar active="games" user={user} />)
    act(() => { vi.advanceTimersByTime(PREFETCH_AFTER_MS + 3000) })
    unmount()
    act(() => { router.prefetch.mock.calls[0][1].onInvalidate() })
    act(() => { vi.advanceTimersByTime(PREFETCH_AFTER_MS + 3000) })
    expect(router.prefetch).toHaveBeenCalledTimes(3)
  })

  it('the loading cover waits, so a kept screen opens with no spinner', () => {
    render(<TabBar active="you" user={user} />)
    fireEvent.click(screen.getByRole('button', { name: 'Games' }))
    expect(router.push).toHaveBeenCalledWith(TAB_HREF.games)
    expect(screen.queryByText('Loading')).toBeNull()
    // The tab you tapped lights at once.
    expect(screen.getAllByRole('button', { name: 'Games' })[0].className).toMatch(/on/)
    act(() => { vi.advanceTimersByTime(COVER_AFTER_MS) })
    expect(screen.getByText('Loading')).toBeTruthy()
  })

  it('a rating, then a tab: the router forgets what it kept before it goes, and never in the background', () => {
    render(<TabBar active="foryou" user={user} onTab={() => false} />)
    announceRated('movie:1', 'loved')
    expect(tabsStale()).toBe(true)
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(router.refresh).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'You' }))
    expect(router.refresh).toHaveBeenCalledTimes(1)
    expect(router.refresh.mock.invocationCallOrder[0]).toBeLessThan(router.push.mock.invocationCallOrder[0])
    expect(tabsStale()).toBe(false)
  })

  it('a save and a hide count as writes', () => {
    render(<TabBar active="foryou" user={user} onTab={() => false} />)
    addToWatchlist({ id: 'movie:9', title: 'T', type: 'movie', year: 2020, poster_url: null, meta: '', rating: 7, match: 0.8, reason: '', where: null, motif: 'dot', palette: ['#000', '#fff'] })
    expect(tabsStale()).toBe(true)
    refreshIfStale(router)
    announceHidden('movie:3', true)
    expect(tabsStale()).toBe(true)
  })

  it('nothing written: leaving never refreshes', () => {
    render(<TabBar active="you" user={user} />)
    fireEvent.click(screen.getByRole('button', { name: 'Games' }))
    refreshIfStale(router)
    expect(router.refresh).not.toHaveBeenCalled()
  })
})
