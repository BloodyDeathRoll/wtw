import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import type { RatingsSummary } from '@/app/api/recommendations/ratings/route'

// S1 (docs/plan/v3/SEEN.md DEC-1, 2, 3, 9): Seen as the Watchlist's rows, chips with no All (opens on Loved), today's
// two dropdowns, and the empty states.

vi.mock('@/lib/share', () => ({ shareTitle: vi.fn() }))

import SeenView, { seenCounts, seenRows } from '@/modules/session/ratings/SeenView'

const facts = { year: 2000, meta: '1h 53m', star: 8.2 }
const DATA: RatingsSummary = {
  counts: { loved: 2, liked: 1, disliked: 0, removed: 1 },
  items: [
    { id: 'movie:1', title: 'Memento', rating: 'loved', created_at: '2026-11-03T00:00:00Z', tmdb_id: '1', media_type: 'movie', poster_url: null, ...facts },
    { id: 'tv:2', title: 'Arcane', rating: 'loved', created_at: '2026-11-05T00:00:00Z', tmdb_id: '2', media_type: 'tv', poster_url: null, year: 2021, meta: '~40m episodes', star: 8.7 },
    { id: 'movie:3', title: 'Heat', rating: 'liked', created_at: '2026-11-04T00:00:00Z', tmdb_id: '3', media_type: 'movie', poster_url: null, ...facts },
  ],
  removed: [
    { title: 'The Hunger Games', tmdb_id: '4', media_type: 'movie', removed_at: '2026-11-01T00:00:00Z', poster_url: null, ...facts },
  ],
}

const titles = () => screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)

function serve(data: RatingsSummary) {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(data)))
}
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('seenRows and seenCounts', () => {
  it('a chip, the type filter and the sort; Date Added is newest first', () => {
    expect(seenRows(DATA, 'loved', 'all', 'newest').map((r) => r.title)).toEqual(['Arcane', 'Memento'])
    expect(seenRows(DATA, 'loved', 'all', 'oldest').map((r) => r.title)).toEqual(['Memento', 'Arcane'])
    expect(seenRows(DATA, 'loved', 'movie', 'newest').map((r) => r.title)).toEqual(['Memento'])
    expect(seenRows(DATA, 'loved', 'all', 'title').map((r) => r.title)).toEqual(['Arcane', 'Memento'])
    expect(seenRows(DATA, 'hidden', 'all', 'newest').map((r) => [r.title, r.reaction])).toEqual([['The Hunger Games', null]])
  })
  it('counts the part under the type filter', () => {
    expect(seenCounts(DATA, 'all')).toEqual({ loved: 2, liked: 1, disliked: 0, hidden: 1 })
    expect(seenCounts(DATA, 'tv')).toEqual({ loved: 1, liked: 0, disliked: 0, hidden: 0 })
  })
})

describe('SeenView', () => {
  beforeEach(() => serve(DATA))

  it('"Seen (N)" counts every rated title; chips Loved · Liked · Disliked · Hidden, no All, Loved lit', async () => {
    render(<SeenView onBack={() => {}} />)
    expect(await screen.findByText('Seen (3)')).toBeInTheDocument()
    const chips = within(screen.getByRole('group', { name: 'Show' })).getAllByRole('button')
    expect(chips.map((c) => c.textContent)).toEqual(['Loved2', 'Liked1', 'Disliked', 'Hidden from For you1'])
    expect(chips[0]).toHaveAttribute('aria-pressed', 'true')
    expect(titles()).toEqual(['Arcane', 'Memento'])
  })

  it('a row: title, year · length · ★, and the reaction where the Watchlist shows the match', async () => {
    render(<SeenView onBack={() => {}} />)
    const row = (await screen.findByText('Memento')).closest('[aria-label="Memento"]')!
    expect(row).toHaveTextContent('2000')
    expect(row).toHaveTextContent('1h 53m')
    expect(row).toHaveTextContent('8.2')
    expect(row).toHaveTextContent('❤️ Loved')
  })

  it('the facts line shows only what we know: no "0", no "★ 0.0"', async () => {
    serve({
      ...DATA,
      items: [
        { ...DATA.items[0], title: 'No score', year: 1999, meta: '1h 40m', star: null },
        { ...DATA.items[1], title: 'No year', year: null, meta: '~40m episodes', star: 8.7 },
        { ...DATA.items[0], id: 'movie:9', title: 'Not in titles', year: null, meta: null, star: null },
      ],
    })
    render(<SeenView onBack={() => {}} />)
    const noScore = await screen.findByLabelText('No score')
    expect(noScore).toHaveTextContent('1999')
    expect(noScore).toHaveTextContent('1h 40m')
    expect(noScore).not.toHaveTextContent('0.0')
    const noYear = screen.getByLabelText('No year')
    expect(noYear).toHaveTextContent('~40m episodes')
    expect(noYear).toHaveTextContent('8.7')
    expect(screen.getByLabelText('Not in titles').textContent).toBe('Not in titles❤️ Loved')
  })

  it("today's two dropdowns: type and sort", async () => {
    render(<SeenView onBack={() => {}} />)
    await screen.findByText('Seen (3)')
    fireEvent.change(screen.getByLabelText('show movies, series or all'), { target: { value: 'tv' } })
    expect(titles()).toEqual(['Arcane'])
    fireEvent.change(screen.getByLabelText('show movies, series or all'), { target: { value: 'all' } })
    fireEvent.change(screen.getByLabelText('sort by'), { target: { value: 'oldest' } })
    expect(titles()).toEqual(['Memento', 'Arcane'])
  })

  it('a chip with nothing behind it: one line, the chip still lit', async () => {
    render(<SeenView onBack={() => {}} />)
    await screen.findByText('Seen (3)')
    const disliked = screen.getByRole('button', { name: 'Disliked' })
    fireEvent.click(disliked)
    expect(screen.getByText('Nothing disliked yet.')).toBeInTheDocument()
    expect(disliked).toHaveAttribute('aria-pressed', 'true')
  })

  it('Hidden from For you lists the hidden titles, with no reaction', async () => {
    render(<SeenView onBack={() => {}} />)
    await screen.findByText('Seen (3)')
    fireEvent.click(screen.getByRole('button', { name: /^Hidden from For you/ }))
    expect(titles()).toEqual(['The Hunger Games'])
    expect(screen.getByLabelText('The Hunger Games')).not.toHaveTextContent(/Loved|Liked|Disliked/)
  })

  it('nothing rated: the line and the orange "Go to For you", no chips or dropdowns', async () => {
    serve({ counts: { loved: 0, liked: 0, disliked: 0, removed: 0 }, items: [], removed: [] })
    const onBrowse = vi.fn()
    render(<SeenView onBack={() => {}} onBrowse={onBrowse} />)
    expect(await screen.findByText('Seen (0)')).toBeInTheDocument()
    expect(screen.getByText(/Nothing here yet\. Tap Loved, Liked or Disliked on any title you.ve seen and it lands here\./)).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Show' })).toBeNull()
    expect(screen.queryByLabelText('sort by')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Go to For you' }))
    expect(onBrowse).toHaveBeenCalledTimes(1)
  })
})
