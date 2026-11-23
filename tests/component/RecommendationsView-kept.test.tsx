import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import RecommendationsView from '@/modules/session/recommendations/RecommendationsView'
import { forgetHeldForTests, heldTwenty, holdsTwenty, isNewTwenty } from '@/modules/session/recommendations/held-twenty'
import { announceRated } from '@/modules/session/recommendations/rate'
import type { Recommendation, RecPage } from '@/types/recommendation'

// v3 F8 (FAST_TABS; docs/plan/v3/PLAN.md §4 F8): For you keeps its 20 on the phone between tabs. Coming back paints
// them at once, as you left them, with no loader; a quiet read behind them swaps in a new 20 only if the server's 20
// changed (a Refresh on another device). Flag off: today's read behind the loader, every time.

const card = (n: number): Recommendation => ({
  id: `movie:${n}`, title: `Title ${n}`, type: 'movie', year: 2020, poster_url: null, meta: '1h 40m',
  rating: 7, match: 0.8, reason: 'r', where: null, motif: 'dot', palette: ['#000', '#fff'],
})
const setOf = (ns: number[], rated: Record<number, 'loved'> = {}): RecPage => ({
  recommendations: ns.map((n) => ({ ...card(n), ...(rated[n] ? { rated: rated[n] } : {}) })),
  next_offset: ns.length, has_more: false, source: 'set', taste_version: 7, set: true,
})
const range = (from: number, n = 20) => Array.from({ length: n }, (_, i) => from + i)
const user = { id: 'u1', email: null, name: 'S', avatarUrl: null }

let serverSet: RecPage
let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  localStorage.clear()
  forgetHeldForTests()
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} unobserve() {} })
  Element.prototype.scrollTo = () => {}
  serverSet = setOf(range(1))
  fetchMock = vi.fn(async (url: string) =>
    String(url).startsWith('/api/recommendations/generate')
      ? new Response(JSON.stringify(serverSet))
      : new Response(JSON.stringify({ ok: true })),
  )
  vi.stubGlobal('fetch', fetchMock)
  process.env.FOR_YOU_V3 = 'true'
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  delete process.env.FOR_YOU_V3
  delete process.env.FAST_TABS
})

const reads = () => fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/recommendations/generate')).length
const view = () => <RecommendationsView onBack={() => {}} contentType="all" onRefresh={vi.fn()} user={user} />

describe('isNewTwenty', () => {
  it('a title the kept 20 never had is a new 20; fewer titles is the same 20', () => {
    expect(isNewTwenty({ served: ['a', 'b', 'c'] }, [{ id: 'a' }, { id: 'c' }])).toBe(false)
    expect(isNewTwenty({ served: ['a', 'b', 'c'] }, [{ id: 'a' }, { id: 'z' }])).toBe(true)
  })
})

describe('flag off: today', () => {
  it('keeps nothing; coming back reads the 20 again behind the loader', async () => {
    const first = render(view())
    await screen.findByText('Title 20')
    first.unmount()
    expect(holdsTwenty('u1')).toBe(false)
    render(view())
    expect(screen.getByText('Finding matches')).toBeTruthy()
    await screen.findByText('Title 20')
    expect(reads()).toBe(2)
  })
})

describe('FAST_TABS on', () => {
  beforeEach(() => { process.env.FAST_TABS = 'true' })

  it('coming back paints the 20 at once, with your chip and your Hide note, and no loader', async () => {
    const first = render(view())
    await screen.findByText('Title 20')
    fireEvent.click(screen.getAllByRole('button', { name: /^Loved/ })[0])
    fireEvent.click(screen.getAllByRole('button', { name: 'Hide' })[1])
    await screen.findByText('Undo')
    first.unmount()
    expect(heldTwenty('u1', 'all')?.hidden).toEqual({ 'movie:2': 0 })

    render(view())
    // At once: the first render, before any read lands.
    expect(screen.queryByText('Finding matches')).toBeNull()
    expect(screen.getByText('Title 1')).toBeTruthy()
    expect(screen.getByText('Title 20')).toBeTruthy()
    expect(screen.getByText('Undo')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /^Loved/ })[0].getAttribute('aria-pressed')).toBe('true')
    // The quiet read behind them: the same 20, so nothing moves.
    await waitFor(() => expect(reads()).toBe(2))
    expect(screen.getByText('Title 1')).toBeTruthy()
  })

  it('a new 20 on the server (a Refresh on another device) takes their place', async () => {
    const first = render(view())
    await screen.findByText('Title 20')
    first.unmount()
    serverSet = setOf(range(101))
    render(view())
    expect(screen.getByText('Title 1')).toBeTruthy()
    await screen.findByText('Title 101')
    expect(screen.queryByText('Title 1')).toBeNull()
  })

  it('a rating made elsewhere while For you was closed shows on its card', async () => {
    const first = render(view())
    await screen.findByText('Title 20')
    first.unmount()
    announceRated('movie:3', 'loved')
    render(view())
    expect(screen.getAllByRole('button', { name: /^Loved/ })[2].getAttribute('aria-pressed')).toBe('true')
  })

  it('a failed quiet read leaves the kept 20 on screen', async () => {
    const first = render(view())
    await screen.findByText('Title 20')
    first.unmount()
    fetchMock.mockImplementation(async () => { throw new Error('offline') })
    render(view())
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(screen.getByText('Title 20')).toBeTruthy()
    expect(screen.queryByText('Finding matches')).toBeNull()
  })

  it('each list keeps its own 20', async () => {
    const first = render(view())
    await screen.findByText('Title 20')
    first.unmount()
    serverSet = setOf(range(201))
    render(<RecommendationsView onBack={() => {}} contentType="movies" onRefresh={vi.fn()} user={user} />)
    expect(screen.getByText('Finding matches')).toBeTruthy()
    await screen.findByText('Title 201')
    expect(heldTwenty('u1', 'all')?.recs[0].id).toBe('movie:1')
    expect(heldTwenty('u1', 'movies')?.recs[0].id).toBe('movie:201')
  })
})

describe('Refresh opens the new 20 at the top (v3 F1, found by Eran 2026-11-22)', () => {
  it('a new list in place of the old (not the old one scrolled), which tells the tab memory it is at the top', async () => {
    const onRefresh = vi.fn(async () => setOf(range(101)))
    render(<RecommendationsView onBack={() => {}} contentType="all" onRefresh={onRefresh} user={user} />)
    await screen.findByText('Title 20')
    const before = document.querySelector('[data-tab-scroll]') as HTMLElement
    before.scrollTop = 4000
    const scrolls: number[] = []
    document.addEventListener('scroll', (e) => { if ((e.target as HTMLElement).hasAttribute?.('data-tab-scroll')) scrolls.push((e.target as HTMLElement).scrollTop) }, true)
    fireEvent.click(screen.getAllByRole('button', { name: 'Refresh' })[1])
    await screen.findByText('Title 101')
    const after = document.querySelector('[data-tab-scroll]') as HTMLElement
    expect(after).not.toBe(before)
    expect(after.scrollTop).toBe(0)
    expect(scrolls).toEqual([0])
  })
})
