import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import RecommendationsView from '@/modules/session/recommendations/RecommendationsView'
import type { Recommendation, RecPage } from '@/types/recommendation'

// v3 F1 (FOR-YOU.md DEC-1–2, docs/prototypes/for-you-v3/9-refresh-at-the-end.jpg, 10-refresh-at-the-top.jpg): when
// the server sends the 20 (`set`), For you shows all of them with the top line and the end card, and nothing else
// changes them but Refresh. A page without `set` is today's feed.

const card = (n: number): Recommendation => ({
  id: `movie:${n}`, title: `Title ${n}`, type: 'movie', year: 2020, poster_url: null, meta: '1h 40m',
  rating: 7, match: 0.8, reason: 'r', where: null, motif: 'dot', palette: ['#000', '#fff'],
})
const setOf = (ns: number[]): RecPage => ({
  recommendations: ns.map(card), next_offset: ns.length, has_more: false, source: 'set', taste_version: 7, set: true,
})
const range = (from: number, n = 20) => Array.from({ length: n }, (_, i) => from + i)

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} unobserve() {} })
  Element.prototype.scrollTo = () => {}
  fetchMock = vi.fn(async () => new Response(JSON.stringify(setOf(range(1)))))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

const pageFetches = () => fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/recommendations/generate')).length
const END_TEXT = 'Want 20 fresh ones? Or tell me what you’re in the mood for, and I’ll look for it.'

describe('<RecommendationsView /> the 20', () => {
  it('shows all 20 with the top line and the end card, and no "Find more"', async () => {
    const onTalk = vi.fn()
    render(<RecommendationsView onBack={() => {}} contentType="all" onFindMore={vi.fn()} onRefresh={vi.fn()} onTalk={onTalk} />)
    await screen.findByText('Title 20')
    expect(screen.getByText('Your 20 picks')).toBeTruthy()
    const end = screen.getByRole('group', { name: 'That’s your 20 picks' })
    expect(within(end).getByText('That’s your 20 picks')).toBeTruthy()
    expect(within(end).getByText(END_TEXT)).toBeTruthy()
    expect(within(end).getByRole('button', { name: 'Refresh' })).toBeTruthy()
    fireEvent.click(within(end).getByRole('button', { name: 'Tell me what you want' }))
    expect(onTalk).toHaveBeenCalledTimes(1)
    expect(screen.getAllByRole('button', { name: 'Refresh' })).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Find more' })).toBeNull()
    expect(pageFetches()).toBe(1)
  })

  it('without the chat (off, or out of turns): Refresh alone, and only the first sentence', async () => {
    render(<RecommendationsView onBack={() => {}} contentType="all" onRefresh={vi.fn()} />)
    await screen.findByText('Title 20')
    const end = screen.getByRole('group', { name: 'That’s your 20 picks' })
    expect(within(end).getByText('Want 20 fresh ones?')).toBeTruthy()
    expect(within(end).queryByText(END_TEXT)).toBeNull()
    expect(within(end).queryByRole('button', { name: 'Tell me what you want' })).toBeNull()
  })

  it('Refresh puts the new 20 in place of the old, without another fetch', async () => {
    const onRefresh = vi.fn(async () => setOf(range(101)))
    render(<RecommendationsView onBack={() => {}} contentType="all" onRefresh={onRefresh} />)
    await screen.findByText('Title 1')
    fireEvent.click(screen.getAllByRole('button', { name: 'Refresh' })[0])
    await screen.findByText('Title 101')
    expect(screen.queryByText('Title 1')).toBeNull()
    expect(screen.getByText('Title 120')).toBeTruthy()
    expect(screen.getByText('Your 20 picks')).toBeTruthy()
    expect(pageFetches()).toBe(1)
  })

  it('a failed Refresh keeps the same 20, and the top line says so', async () => {
    const onRefresh = vi.fn(async () => null)
    render(<RecommendationsView onBack={() => {}} contentType="all" onRefresh={onRefresh} />)
    await screen.findByText('Title 1')
    fireEvent.click(screen.getAllByRole('button', { name: 'Refresh' })[1])
    await screen.findByText('Couldn’t refresh right now')
    expect(screen.queryByText('Your 20 picks')).toBeNull()
    expect(screen.getByText('Title 1')).toBeTruthy()
    expect(screen.getByText('Title 20')).toBeTruthy()
  })

  it('a page without `set` (flag off, or the 20 unreadable) is today\'s feed: no top line, no end card', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ ...setOf([1, 2]), set: undefined })))
    render(<RecommendationsView onBack={() => {}} contentType="all" onFindMore={vi.fn()} onRefresh={vi.fn()} />)
    await screen.findByText('Title 1')
    expect(screen.queryByText('Your 20 picks')).toBeNull()
    expect(screen.queryByRole('group', { name: 'That’s your 20 picks' })).toBeNull()
    expect(await screen.findByRole('button', { name: 'Find more' })).toBeTruthy()
  })
})
