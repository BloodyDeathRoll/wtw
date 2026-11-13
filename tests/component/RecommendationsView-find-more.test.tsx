import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import RecommendationsView from '@/modules/session/recommendations/RecommendationsView'
import type { Recommendation, RecPage } from '@/types/recommendation'

// 2026-11-13: "Find more" used to wait for session/end and then fetch the new
// batch's first page (~1.6 s more). session/end now returns that page; the
// feed shows it as is and fetches only when it is missing.

const card = (n: number): Recommendation => ({
  id: `movie:${n}`, title: `Title ${n}`, type: 'movie', year: 2020, poster_url: null, meta: '1h 40m',
  rating: 7, match: 0.8, reason: 'r', where: null, motif: 'dot', palette: ['#000', '#fff'],
})
const pageOf = (ns: number[], has_more = false): RecPage => ({
  recommendations: ns.map(card), next_offset: ns.length, has_more, source: 'cache', taste_version: 7,
})

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} unobserve() {} })
  fetchMock = vi.fn(async () => new Response(JSON.stringify(pageOf([1, 2]))))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

const pageFetches = () => fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/recommendations/generate')).length

describe('<RecommendationsView /> Find more', () => {
  it('shows the page session/end returned, without a second fetch', async () => {
    const onFindMore = vi.fn(async () => pageOf([2, 3]))
    render(<RecommendationsView onBack={() => {}} contentType="movies" onFindMore={onFindMore} />)
    await screen.findByText('Title 1')
    expect(pageFetches()).toBe(1)

    fireEvent.click(await screen.findByRole('button', { name: 'Find more' }))

    await screen.findByText('Title 3')
    expect(screen.getAllByText('Title 2')).toHaveLength(1) // already on screen: not repeated
    expect(pageFetches()).toBe(1)
  })

  it('fetches the first page when session/end returned none', async () => {
    const onFindMore = vi.fn(async () => null)
    render(<RecommendationsView onBack={() => {}} contentType="movies" onFindMore={onFindMore} />)
    await screen.findByText('Title 1')
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(pageOf([4]))))

    fireEvent.click(await screen.findByRole('button', { name: 'Find more' }))

    await screen.findByText('Title 4')
    await waitFor(() => expect(pageFetches()).toBe(2))
  })
})
