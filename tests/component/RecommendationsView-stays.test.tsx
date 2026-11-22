import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import RecommendationsView from '@/modules/session/recommendations/RecommendationsView'
import { addToWatchlist, getWatchlist } from '@/lib/watchlist'
import type { Recommendation, RecPage } from '@/types/recommendation'

// v3 F2 (FOR-YOU.md DEC-4, docs/prototypes/for-you-v3/1-during-a-visit.jpg, #350): in the 20, a card you saved or
// rated stays where it is and shows what you did, until Refresh. Coming back (a tab hop remounts the view) the server
// sends the same 20, a rated card carrying `rated`; a saved one is on the Watchlist. Today's feed (no `set`) still
// drops a saved title, and says "Saved to Ratings".

const card = (n: number, rated?: Recommendation['rated']): Recommendation => ({
  id: `movie:${n}`, title: `Title ${n}`, type: 'movie', year: 2020, poster_url: null, meta: '1h 40m',
  rating: 7, match: 0.8, reason: 'r', where: null, motif: 'dot', palette: ['#000', '#fff'], ...(rated ? { rated } : {}),
})
const range = (from: number, n = 20) => Array.from({ length: n }, (_, i) => from + i)
const setOf = (cards: Recommendation[], set = true): RecPage => ({
  recommendations: cards, next_offset: cards.length, has_more: false, source: 'set', taste_version: 7, ...(set ? { set } : {}),
})
// The 20 as the server sends them back after you saved Title 3 and loved Title 5.
const comeBack = () => setOf(range(1).map((n) => card(n, n === 5 ? 'loved' : undefined)))

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} unobserve() {} })
  Element.prototype.scrollTo = () => {}
  fetchMock = vi.fn(async (url: string) =>
    String(url).startsWith('/api/recommendations/generate')
      ? new Response(JSON.stringify(comeBack()))
      : new Response('{}'),
  )
  vi.stubGlobal('fetch', fetchMock)
  addToWatchlist(card(3))
})
afterEach(() => vi.unstubAllGlobals())

const cardOf = (title: string) => screen.getByText(title).closest('article') as HTMLElement
const feedbackCalls = (method: string) =>
  fetchMock.mock.calls.filter(([url, init]) => url === '/api/recommendations/feedback' && init?.method === method)

describe('<RecommendationsView /> what you did stays on the card (F2)', () => {
  it('coming back, the saved and the rated cards are still there, in place and lit', async () => {
    render(<RecommendationsView onBack={() => {}} contentType="all" onRefresh={vi.fn()} />)
    await screen.findByText('Title 20')
    const titles = screen.getAllByRole('heading').map((h) => h.textContent).filter((t) => t?.startsWith('Title'))
    expect(titles.slice(0, 6)).toEqual(['Title 1', 'Title 2', 'Title 3', 'Title 4', 'Title 5', 'Title 6'])

    const saved = cardOf('Title 3')
    expect(within(saved).getByRole('button', { name: /^Remove from Watchlist/ }).getAttribute('aria-pressed')).toBe('true')
    expect(within(saved).queryByRole('button', { name: /Hide/ })).toBeNull()

    const rated = cardOf('Title 5')
    expect(within(rated).getByRole('button', { name: 'Loved it (tap to clear)' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(rated).getByText('Saved to Seen')).toBeTruthy()
    expect(within(rated).getByRole('button', { name: /^Add to Watchlist/ })).toBeTruthy()
  })

  it('un-save works from the card, and the card stays', async () => {
    render(<RecommendationsView onBack={() => {}} contentType="all" onRefresh={vi.fn()} />)
    await screen.findByText('Title 20')
    fireEvent.click(within(cardOf('Title 3')).getByRole('button', { name: /^Remove from Watchlist/ }))
    expect(within(cardOf('Title 3')).getByRole('button', { name: /^Add to Watchlist/ })).toBeTruthy()
    expect(getWatchlist().some((e) => e.rec.id === 'movie:3')).toBe(false)
  })

  it('un-rate works from the card, and the card stays', async () => {
    render(<RecommendationsView onBack={() => {}} contentType="all" onRefresh={vi.fn()} />)
    await screen.findByText('Title 20')
    fireEvent.click(within(cardOf('Title 5')).getByRole('button', { name: 'Loved it (tap to clear)' }))
    expect(within(cardOf('Title 5')).getByText('Seen it? Tell me, and your picks get sharper')).toBeTruthy()
    expect(within(cardOf('Title 5')).getByRole('button', { name: 'Loved it' }).getAttribute('aria-pressed')).toBe('false')
    await waitFor(() => expect(feedbackCalls('DELETE')).toHaveLength(1))
  })

  it('saved and rated on one card: un-saving keeps the rating lit (it is in Seen)', async () => {
    addToWatchlist(card(5))
    render(<RecommendationsView onBack={() => {}} contentType="all" onRefresh={vi.fn()} />)
    await screen.findByText('Title 20')
    fireEvent.click(within(cardOf('Title 5')).getByRole('button', { name: /^Remove from Watchlist/ }))
    expect(within(cardOf('Title 5')).getByRole('button', { name: 'Loved it (tap to clear)' })).toBeTruthy()
  })

  it('Refresh drops both: the new 20 never show a title on the Watchlist', async () => {
    const onRefresh = vi.fn(async () => setOf([card(3), ...range(101, 19).map((n) => card(n))]))
    render(<RecommendationsView onBack={() => {}} contentType="all" onRefresh={onRefresh} />)
    await screen.findByText('Title 5')
    fireEvent.click(screen.getAllByRole('button', { name: 'Refresh' })[0])
    await screen.findByText('Title 101')
    expect(screen.queryByText('Title 3')).toBeNull()
    expect(screen.queryByText('Title 5')).toBeNull()
  })

  it('today\'s feed (no `set`): a saved title still drops out, and a rating says "Saved to Ratings"', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).startsWith('/api/recommendations/generate')
        ? new Response(JSON.stringify(setOf([1, 2, 3, 4].map((n) => card(n)), false)))
        : new Response('{}'),
    )
    render(<RecommendationsView onBack={() => {}} contentType="all" onFindMore={vi.fn()} />)
    await screen.findByText('Title 4')
    expect(screen.queryByText('Title 3')).toBeNull()
    fireEvent.click(within(cardOf('Title 2')).getByRole('button', { name: 'Loved it' }))
    expect(within(cardOf('Title 2')).getByText('Saved to Ratings')).toBeTruthy()
  })
})
