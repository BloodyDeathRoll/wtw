import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import type { Recommendation } from '@/types/recommendation'

// The Watchlist as rows (docs/plan/v3/WATCHLIST.md): the header count, the
// chips, the order with the Seen line, the star, the card page with Remove,
// the "Removed … Undo" note, and the empty state's button.

vi.mock('@/lib/share', () => ({ shareTitle: vi.fn() }))

import RecommendationsView from '@/modules/session/recommendations/RecommendationsView'

function rec(id: string, o: Partial<Recommendation> = {}): Recommendation {
  return {
    id, title: `Title ${id}`, type: 'movie', year: 2008, poster_url: null, meta: '1h 45m',
    rating: 8.2, match: 0.9, reason: 'A saved line', where: 'Hulu', motif: 'spades', palette: ['#1B2A28', '#C7B8FF'], ...o,
  }
}

function seed(entries: Record<string, unknown>[]) {
  window.localStorage.setItem('wtw_watchlist', JSON.stringify(entries))
}

const THREE = [
  { rec: rec('movie:1', { where_il: 'Netflix' }), added_at: 3, rating: null, starred: false, explain: null, synced: true },
  { rec: rec('movie:2', { where_il: 'Apple TV' }), added_at: 2, rating: null, starred: true, explain: null, synced: true },
  { rec: rec('tv:3', { type: 'tv', where_il: null }), added_at: 1, rating: 'loved', starred: false, explain: null, synced: true },
]

const rowNames = () =>
  screen.getAllByRole('button', { name: /: open$/ }).map((b) => b.getAttribute('aria-label')!.replace(': open', ''))

beforeEach(() => {
  window.localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('why-lines')) return Response.json({ lines: { 'movie:1': 'Fresh line', 'movie:2': 'Fresh line' } })
    if (url.includes('/why?')) return Response.json({ text: null })
    if (url.includes('/explain?')) return new Response('', { status: 404 })
    return Response.json({ entries: [] })
  }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const view = (extra: Partial<Parameters<typeof RecommendationsView>[0]> = {}) =>
  render(<RecommendationsView onBack={() => {}} contentType="all" mode="watchlist" {...extra} />)

describe('the list', () => {
  it('counts everything in the header, and orders starred → rest → Seen', () => {
    seed(THREE)
    view()
    expect(screen.getByText('Watchlist (3)')).toBeInTheDocument()
    expect(rowNames()).toEqual(['Title movie:2', 'Title movie:1', 'Title tv:3'])
    expect(screen.getByRole('separator', { name: 'Seen, 1' })).toHaveTextContent('Seen 1')
  })

  it('a row says where it streams in Israel and the match; a Seen row says the reaction', () => {
    seed(THREE)
    view()
    const one = screen.getByRole('button', { name: 'Title movie:1: open' })
    expect(one).toHaveTextContent('Netflix')
    expect(one).toHaveTextContent('90% match')
    const seen = screen.getByRole('button', { name: 'Title tv:3: open' })
    expect(seen).toHaveTextContent('❤️ Loved')
    expect(seen).not.toHaveTextContent('match')
  })

  it('shows one chip per part with its count, All lit; a service only when a title is on it', () => {
    seed(THREE)
    view()
    const group = screen.getByRole('group', { name: 'Show' })
    const chips = within(group).getAllByRole('button')
    expect(chips.map((c) => c.textContent)).toEqual(['All3', 'Starred1', 'Movies2', 'Series1', 'Netflix1', 'Apple TV1', 'Seen1'])
    expect(chips[0]).toHaveAttribute('aria-pressed', 'true')
  })

  it('a chip filters the rows and keeps the header count; the lit chip again returns to All', () => {
    seed(THREE)
    view()
    const group = screen.getByRole('group', { name: 'Show' })
    fireEvent.click(within(group).getByRole('button', { name: /^Netflix/ }))
    expect(rowNames()).toEqual(['Title movie:1'])
    expect(screen.getByText('Watchlist (3)')).toBeInTheDocument()
    fireEvent.click(within(group).getByRole('button', { name: /^Seen/ }))
    expect(rowNames()).toEqual(['Title tv:3'])
    expect(screen.queryByRole('separator')).toBeNull()
    fireEvent.click(within(group).getByRole('button', { name: /^Seen/ }))
    expect(rowNames()).toHaveLength(3)
  })

  it('a filter with nothing behind it says so, with the chip still lit', () => {
    seed([THREE[0]])
    view()
    const group = screen.getByRole('group', { name: 'Show' })
    fireEvent.click(within(group).getByRole('button', { name: /^Starred/ }))
    expect(screen.getByText('Nothing starred yet. Star a title and it stays at the top of your list.')).toBeInTheDocument()
    expect(within(group).getByRole('button', { name: /^Starred/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('the star moves a title to the top and persists', () => {
    seed(THREE)
    view()
    fireEvent.click(screen.getByRole('button', { name: 'Star Title movie:1' }))
    expect(rowNames()).toEqual(['Title movie:1', 'Title movie:2', 'Title tv:3'])
    const stored = JSON.parse(window.localStorage.getItem('wtw_watchlist')!) as { rec: { id: string }; starred: boolean }[]
    expect(stored.find((e) => e.rec.id === 'movie:1')!.starred).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /^Starred: Title movie:1/ }))
    expect(rowNames()).toEqual(['Title movie:2', 'Title movie:1', 'Title tv:3'])
  })

  it('a swipe follows the finger, then settles open past the threshold', () => {
    seed(THREE)
    view()
    const row = screen.getByRole('button', { name: 'Title movie:1: open' })
    fireEvent.pointerDown(row, { clientX: 300, clientY: 100, pointerId: 1 })
    // Past the slop: the row has moved exactly as far as the finger, not to fully open.
    fireEvent.pointerMove(row, { clientX: 270, clientY: 102, pointerId: 1 })
    expect(row.style.transform).toBe('translateX(-30px)')
    fireEvent.pointerMove(row, { clientX: 220, clientY: 103, pointerId: 1 })
    expect(row.style.transform).toBe('translateX(-80px)')
    fireEvent.pointerUp(row, { clientX: 220, clientY: 103, pointerId: 1 })
    expect(row.style.transform).toBe('translateX(-118px)')
    // The swipe's own click opens nothing.
    fireEvent.click(row)
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
  })

  it('with nothing saved: today\'s text and an orange "Go to For you"', () => {
    const browse = vi.fn()
    view({ onBrowse: browse })
    expect(screen.getByText('Watchlist (0)')).toBeInTheDocument()
    expect(screen.getByText(/^Nothing saved yet\./)).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Show' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Go to For you' }))
    expect(browse).toHaveBeenCalled()
  })
})

describe('the card page', () => {
  it('opens from a row with Back, the saved button, the star and no "Why it\'s a match" link', async () => {
    seed(THREE)
    view()
    fireEvent.click(screen.getByRole('button', { name: 'Title movie:1: open' }))
    expect(screen.getByRole('button', { name: 'back' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove from Watchlist: Title movie:1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Star Title movie:1' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Why Title movie:1 is a match/ })).toBeNull()
    expect(screen.queryByText('Watchlist (3)')).toBeNull()
    // The breakdown is on the page: its "Why" label (the text is still being written).
    await waitFor(() => expect(screen.getByText('Why')).toBeInTheDocument())
  })

  it('Remove goes back to the list, where the row is a note with Undo; the counts follow', async () => {
    seed(THREE)
    view()
    fireEvent.click(screen.getByRole('button', { name: 'Title movie:1: open' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove from Watchlist: Title movie:1' }))
    await waitFor(() => expect(screen.getByText('Watchlist (2)')).toBeInTheDocument())
    const note = screen.getByRole('status')
    expect(note).toHaveTextContent('Removed. Title movie:1 is off your Watchlist.')
    // The note sits where the row was: after the starred title, before Seen.
    const group = screen.getByRole('group', { name: 'Show' })
    expect(within(group).getAllByRole('button')[0]).toHaveTextContent('All2')
    expect(rowNames()).toEqual(['Title movie:2', 'Title tv:3'])
    fireEvent.click(within(note).getByRole('button', { name: 'Undo' }))
    expect(screen.getByText('Watchlist (3)')).toBeInTheDocument()
    expect(rowNames()).toEqual(['Title movie:2', 'Title movie:1', 'Title tv:3'])
    expect(JSON.parse(window.localStorage.getItem('wtw_watchlist')!)).toHaveLength(3)
  })
})

// v3 L1 (#372, Eran's B): one "Where to watch: JustWatch" line per screen, only where a service is shown.
describe('the JustWatch credit', () => {
  const CREDIT = 'Where to watch: JustWatch'

  it('ends the list once when a row shows a service', () => {
    seed(THREE)
    view()
    expect(screen.getAllByText(CREDIT)).toHaveLength(1)
  })

  it('is absent when no row shows one (a Seen row shows its reaction, not its service)', () => {
    seed([
      { rec: rec('movie:1', { where_il: null }), added_at: 2, rating: null, starred: false, explain: null, synced: true },
      { rec: rec('movie:2', { where_il: 'Netflix' }), added_at: 1, rating: 'liked', starred: false, explain: null, synced: true },
    ])
    view()
    expect(screen.queryByText(CREDIT)).toBeNull()
  })

  it('waits for the real end: not while more rows are still to come', () => {
    seed(Array.from({ length: 8 }, (_, i) => (
      { rec: rec(`movie:${i + 1}`, { where_il: 'Netflix' }), added_at: 8 - i, rating: null, starred: false, explain: null, synced: true }
    )))
    view()
    expect(rowNames()).toHaveLength(6) // the first page; the rest come as you scroll
    expect(screen.queryByText(CREDIT)).toBeNull()
  })

  it('sits under the card on the card page when the title has a service, and not when it has none', () => {
    seed(THREE)
    view()
    fireEvent.click(screen.getByRole('button', { name: 'Title movie:1: open' }))
    expect(screen.getAllByText(CREDIT)).toHaveLength(1)
    cleanup()
    seed(THREE)
    view()
    fireEvent.click(screen.getByRole('button', { name: 'Title tv:3: open' }))
    expect(screen.queryByText(CREDIT)).toBeNull()
  })
})
