import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, within, act, waitFor } from '@testing-library/react'
import type { RatingsSummary } from '@/app/api/recommendations/ratings/route'

// S1 (docs/plan/v3/SEEN.md DEC-1, 2, 3, 9): Seen as the Watchlist's rows, chips with no All (opens on Loved), today's
// two dropdowns, and the empty states.

vi.mock('@/lib/share', () => ({ shareTitle: vi.fn() }))

import SeenView, { seenCounts, seenRows } from '@/modules/session/ratings/SeenView'
import { forgetMyRatings } from '@/app/search/SearchCard'
import { announceRated } from '@/modules/session/recommendations/rate'

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

  it('a row: title, year · length · ★, and your reaction lit among ❤️ 👍 👎 (S2, DEC-4)', async () => {
    render(<SeenView onBack={() => {}} />)
    const row = (await screen.findByText('Memento')).closest('[aria-label="Memento"]')!
    expect(row).toHaveTextContent('2000')
    expect(row).toHaveTextContent('1h 53m')
    expect(row).toHaveTextContent('8.2')
    expect(within(row as HTMLElement).getByRole('button', { name: 'Loved it: Memento' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(row as HTMLElement).getByRole('button', { name: 'Liked it: Memento' })).toHaveAttribute('aria-pressed', 'false')
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
    expect(screen.getByLabelText('Not in titles').textContent).toBe('Not in titles❤️👍👎')
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

describe('#406: Seen never shows "Untitled"', () => {
  it('a title with no name stays out: not a row, not counted', async () => {
    serve({
      ...DATA,
      items: [...DATA.items, { ...DATA.items[0], id: 'movie:9', tmdb_id: '9', title: null }],
      removed: [...DATA.removed, { ...DATA.removed[0], tmdb_id: '10', title: null }],
    })
    render(<SeenView onBack={() => {}} />)
    expect(await screen.findByText('Seen (3)')).toBeInTheDocument()
    expect(titles()).toEqual(['Arcane', 'Memento'])
    expect(screen.queryByText('Untitled')).toBeNull()
    expect(within(screen.getByRole('group', { name: 'Show' })).getAllByRole('button').map((c) => c.textContent)).toEqual(['Loved2', 'Liked1', 'Disliked', 'Hidden from For you1'])
  })
})

describe('S2: change a rating right on the row (DEC-4, DEC-5)', () => {
  let posts: unknown[]
  function serveWith(ok: boolean) {
    posts = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/recommendations/feedback') {
        posts.push(JSON.parse(String(init?.body)))
        return new Response(null, { status: ok ? 200 : 500 })
      }
      return Response.json(DATA)
    }))
  }
  const chipCounts = () => within(screen.getByRole('group', { name: 'Show' })).getAllByRole('button').map((c) => c.textContent)
  const flush = () => new Promise((r) => setTimeout(r, 0))

  it('tap 👍: the gold moves, the counts change, the row stays with a note; it leaves Loved when Loved opens again', async () => {
    serveWith(true)
    render(<SeenView onBack={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Liked it: Memento' }))
    expect(screen.getByRole('button', { name: 'Liked it: Memento' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Loved it: Memento' })).toHaveAttribute('aria-pressed', 'false')
    expect(chipCounts()).toEqual(['Loved1', 'Liked2', 'Disliked', 'Hidden from For you1'])
    expect(titles()).toEqual(['Arcane', 'Memento'])
    expect(screen.getByRole('status')).toHaveTextContent('Memento will move to Liked.')
    await flush()
    expect(posts).toEqual([expect.objectContaining({ action: 'watched', reaction: 'liked', tmdb_id: '1', media_type: 'movie' })])
    const chips = within(screen.getByRole('group', { name: 'Show' }))
    fireEvent.click(chips.getByRole('button', { name: /^Liked/ }))
    fireEvent.click(chips.getByRole('button', { name: /^Loved/ }))
    expect(titles()).toEqual(['Arcane'])
  })

  it('Undo puts the first reaction back, even after a second tap', async () => {
    serveWith(true)
    render(<SeenView onBack={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Liked it: Memento' }))
    fireEvent.click(screen.getByRole('button', { name: "Watched it, didn't like it: Memento" }))
    expect(screen.getByRole('status')).toHaveTextContent('Memento will move to Disliked.')
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByRole('button', { name: 'Loved it: Memento' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('status')).toBeNull()
    expect(chipCounts()).toEqual(['Loved2', 'Liked1', 'Disliked', 'Hidden from For you1'])
    await flush()
    expect((posts as { reaction: string }[]).map((p) => p.reaction)).toEqual(['liked', 'disliked', 'loved'])
  })

  it('a change and its Undo go one after the other; the older answer never puts the row back (P2-G check 1)', async () => {
    posts = []
    const answers: ((r: Response) => void)[] = []
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/recommendations/feedback') {
        posts.push(JSON.parse(String(init?.body)))
        return new Promise<Response>((res) => answers.push(res))
      }
      return Promise.resolve(Response.json(DATA))
    }))
    render(<SeenView onBack={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Liked it: Memento' }))
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await flush()
    // The Undo waits for the change's answer.
    expect((posts as { reaction: string }[]).map((p) => p.reaction)).toEqual(['liked'])
    await act(async () => { answers[0](new Response(null, { status: 200 })); await flush(); await flush() })
    // The change's answer came back after the Undo: the row stays on Loved.
    expect(screen.getByRole('button', { name: 'Loved it: Memento' })).toHaveAttribute('aria-pressed', 'true')
    expect((posts as { reaction: string }[]).map((p) => p.reaction)).toEqual(['liked', 'loved'])
    await act(async () => { answers[1](new Response(null, { status: 200 })); await flush() })
    expect(screen.getByRole('button', { name: 'Loved it: Memento' })).toHaveAttribute('aria-pressed', 'true')
    expect(chipCounts()).toEqual(['Loved2', 'Liked1', 'Disliked', 'Hidden from For you1'])
  })

  it('the lit icon does nothing', async () => {
    serveWith(true)
    render(<SeenView onBack={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Loved it: Memento' }))
    await flush()
    expect(posts).toEqual([])
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('sends the feed\'s content_type with the rating', async () => {
    serveWith(true)
    render(<SeenView onBack={() => {}} contentType="movies" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Liked it: Memento' }))
    await flush()
    expect(posts).toEqual([expect.objectContaining({ content_type: 'movies' })])
  })

  it('the note goes after 5 s', async () => {
    serveWith(true)
    render(<SeenView onBack={() => {}} />)
    const liked = await screen.findByRole('button', { name: 'Liked it: Memento' })
    vi.useFakeTimers()
    try {
      fireEvent.click(liked)
      expect(screen.getByRole('status')).toHaveTextContent('Memento will move to Liked.')
      act(() => { vi.advanceTimersByTime(4999) })
      expect(screen.queryByRole('status')).not.toBeNull()
      act(() => { vi.advanceTimersByTime(1) })
      expect(screen.queryByRole('status')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('two taps that both fail go back to what the server has, not to the first tap', async () => {
    serveWith(false)
    render(<SeenView onBack={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Liked it: Memento' }))
    fireEvent.click(screen.getByRole('button', { name: "Watched it, didn't like it: Memento" }))
    await flush(); await flush()
    expect(screen.getByRole('button', { name: 'Loved it: Memento' })).toHaveAttribute('aria-pressed', 'true')
    expect(chipCounts()).toEqual(['Loved2', 'Liked1', 'Disliked', 'Hidden from For you1'])
  })

  it('a failed write puts the reaction back and drops the note', async () => {
    serveWith(false)
    render(<SeenView onBack={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Liked it: Memento' }))
    await flush(); await flush()
    expect(screen.getByRole('button', { name: 'Loved it: Memento' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('status')).toBeNull()
  })
})

describe('S3: the card page from Seen, and clearing a rating (DEC-6, DEC-7)', () => {
  const user = { id: 'u1', email: null, name: 'Ada', avatarUrl: null }
  let calls: { url: string; method: string; body: Record<string, unknown> | null }[]
  let feedbackOk: boolean
  beforeEach(() => {
    forgetMyRatings()
    window.localStorage.clear()
    vi.stubEnv('SEEN_V3', 'true')
    calls = []
    feedbackOk = true
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null })
      if (url.includes('/api/search/title')) {
        return Response.json({
          rec: { id: 'movie:1', title: 'Memento', type: 'movie', year: 2000, poster_url: null, meta: '1h 53m', rating: 8.2, match: 0, reason: '', where: null, motif: 'dot', palette: ['#16242E', '#F5C9A6'] },
          synopsis: 'Leonard Shelby is tracking down the man who raped and murdered his wife.',
        })
      }
      if (url.includes('/feedback')) return feedbackOk ? Response.json({ ok: true }) : new Response('no', { status: 500 })
      if (url.includes('why-lines')) return Response.json({ lines: {} })
      if (url.includes('/score') || url.includes('/explain')) return new Response('', { status: 404 })
      if (url.includes('/why')) return Response.json({ text: null })
      if (url.includes('/ratings')) return Response.json(DATA)
      return Response.json({ entries: [] })
    }))
  })
  afterEach(() => vi.unstubAllEnvs())
  const flush = () => new Promise((r) => setTimeout(r, 0))
  const chipCounts = () => within(screen.getByRole('group', { name: 'Show' })).getAllByRole('button').map((c) => c.textContent)

  async function openMemento() {
    render(<SeenView onBack={() => {}} user={user} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Memento: open' }))
    await screen.findByRole('button', { name: 'Add to Watchlist: Memento' })
    // The lit chip waits for Seen's list (myRatings), which can land after the card on a slow machine.
    await screen.findByRole('button', { name: 'Loved it (tap to clear)' })
    await flush()
  }

  it('a tap on a row opens its card page: your reaction lit, "Saved to Seen", Add to Watchlist, no Hide', async () => {
    await openMemento()
    expect(calls.some((c) => c.url === '/api/search/title?key=movie-1')).toBe(true)
    expect(await screen.findByText('Saved to Seen')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Loved it (tap to clear)' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: /^Hide/ })).toBeNull()
    expect(screen.queryByText('Seen (3)')).toBeNull()
  })

  it('a tap on a row\'s icon changes the rating and opens nothing', async () => {
    render(<SeenView onBack={() => {}} user={user} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Liked it: Memento' }))
    await flush()
    expect(calls.some((c) => c.url.includes('/api/search/title'))).toBe(false)
    expect(screen.getByRole('status')).toHaveTextContent('Memento will move to Liked.')
  })

  it('a hidden title opens nothing', async () => {
    render(<SeenView onBack={() => {}} user={user} />)
    await screen.findByText('Seen (3)')
    fireEvent.click(screen.getByRole('button', { name: /^Hidden from For you/ }))
    fireEvent.click(screen.getByLabelText('The Hunger Games'))
    await flush()
    expect(calls.some((c) => c.url.includes('/api/search/title'))).toBe(false)
  })

  it('tap the lit reaction to clear it; back on Seen the row is a note with Undo and the counts drop', async () => {
    await openMemento()
    fireEvent.click(screen.getByRole('button', { name: 'Loved it (tap to clear)' }))
    expect(screen.getByRole('button', { name: 'Loved it' })).toHaveAttribute('aria-pressed', 'false')
    await flush(); await flush()
    expect(calls.some((c) => c.url.includes('/feedback') && c.method === 'DELETE')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'back' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Add to Watchlist: Memento' })).toBeNull())
    expect(screen.getByText('Seen (2)')).toBeInTheDocument()
    expect(chipCounts()).toEqual(['Loved1', 'Liked1', 'Disliked', 'Hidden from For you1'])
    expect(screen.getByRole('status')).toHaveTextContent('Rating cleared. Memento is out of Seen, and your taste forgets it.')
    expect(titles()).toEqual(['Arcane'])

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByText('Seen (3)')).toBeInTheDocument()
    expect(chipCounts()).toEqual(['Loved2', 'Liked1', 'Disliked', 'Hidden from For you1'])
    expect(titles()).toEqual(['Arcane', 'Memento'])
    await flush()
    expect(calls.filter((c) => c.url.includes('/feedback') && c.method === 'POST').map((c) => c.body?.reaction)).toEqual(['loved'])
  })

  it('a reaction moved on the card shows on the row back on Seen, with no note', async () => {
    await openMemento()
    fireEvent.click(screen.getByRole('button', { name: 'Liked it' }))
    await flush(); await flush()
    fireEvent.click(screen.getByRole('button', { name: 'back' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Add to Watchlist: Memento' })).toBeNull())
    expect(screen.getByRole('button', { name: 'Liked it: Memento' })).toHaveAttribute('aria-pressed', 'true')
    expect(chipCounts()).toEqual(['Loved1', 'Liked2', 'Disliked', 'Hidden from For you1'])
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('an Undo whose write fails takes the row out again', async () => {
    await openMemento()
    fireEvent.click(screen.getByRole('button', { name: 'Loved it (tap to clear)' }))
    await flush(); await flush()
    fireEvent.click(screen.getByRole('button', { name: 'back' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Add to Watchlist: Memento' })).toBeNull())
    feedbackOk = false
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await flush(); await flush()
    expect(screen.getByText('Seen (2)')).toBeInTheDocument()
    expect(titles()).toEqual(['Arcane'])
    expect(screen.getByRole('status')).toHaveTextContent('Rating cleared. Memento is out of Seen')
  })

  it('once the note has gone, a rating made elsewhere does not bring back the old row', async () => {
    await openMemento()
    fireEvent.click(screen.getByRole('button', { name: 'Loved it (tap to clear)' }))
    await flush(); await flush()
    vi.useFakeTimers()
    try {
      fireEvent.click(screen.getByRole('button', { name: 'back' }))
      await act(async () => { await vi.advanceTimersByTimeAsync(100) })
      expect(screen.getByRole('status')).toHaveTextContent('Rating cleared.')
      act(() => { vi.advanceTimersByTime(5000) })
      expect(screen.queryByRole('status')).toBeNull()
      act(() => { announceRated('movie:1', 'liked') })
      expect(screen.getByText('Seen (2)')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('the list is back at its place when the card closes', async () => {
    render(<SeenView onBack={() => {}} user={user} />)
    const open = await screen.findByRole('button', { name: 'Memento: open' })
    const list = open.closest('[data-tab-scroll]') as HTMLElement
    list.scrollTop = 420
    fireEvent.click(open)
    await screen.findByRole('button', { name: 'Add to Watchlist: Memento' })
    list.scrollTop = 0
    fireEvent.click(screen.getByRole('button', { name: 'back' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Add to Watchlist: Memento' })).toBeNull())
    expect(list.scrollTop).toBe(420)
  })
})

describe('S4: Hidden from For you, with Restore (DEC-8)', () => {
  let calls: { url: string; method: string; body: Record<string, unknown> | null }[]
  let ok: boolean
  beforeEach(() => {
    calls = []
    ok = true
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null })
      if (url === '/api/recommendations/removed') return ok ? Response.json({ ok: true }) : new Response('no', { status: 500 })
      return Response.json(DATA)
    }))
  })
  const flush = () => new Promise((r) => setTimeout(r, 0))
  const hiddenCount = () => within(screen.getByRole('group', { name: 'Show' })).getByRole('button', { name: /^Hidden from For you/ }).textContent
  async function openHidden() {
    render(<SeenView onBack={() => {}} />)
    await screen.findByText('Seen (3)')
    fireEvent.click(screen.getByRole('button', { name: /^Hidden from For you/ }))
  }

  it('the line on top, and a Restore on each hidden row; rated rows have none', async () => {
    await openHidden()
    expect(screen.getByText('You hid these on For you, so they never come back there. Restore one and it can.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Restore The Hunger Games' })).toHaveTextContent('Restore')
    fireEvent.click(screen.getByRole('button', { name: /^Loved/ }))
    expect(screen.queryByRole('button', { name: /^Restore/ })).toBeNull()
    expect(screen.queryByText(/You hid these on For you/)).toBeNull()
  })

  it('Restore: the row folds into the note, the count drops, the server is told; Undo hides it again', async () => {
    await openHidden()
    fireEvent.click(screen.getByRole('button', { name: 'Restore The Hunger Games' }))
    expect(screen.getByRole('status')).toHaveTextContent('Restored. The Hunger Games can show up on For you again.')
    expect(hiddenCount()).toBe('Hidden from For you')
    await flush()
    expect(calls.filter((c) => c.url.includes('/removed')).map((c) => [c.method, c.body])).toEqual([['DELETE', { tmdb_id: '4', media_type: 'movie' }]])
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.queryByRole('status')).toBeNull()
    expect(titles()).toEqual(['The Hunger Games'])
    expect(hiddenCount()).toBe('Hidden from For you1')
    await flush()
    expect(calls.filter((c) => c.url.includes('/removed')).map((c) => c.method)).toEqual(['DELETE', 'POST'])
    expect(calls.at(-1)?.body).toEqual({ tmdb_id: '4', media_type: 'movie', title: 'The Hunger Games' })
  })

  it('a failed Restore puts the row back and drops the note', async () => {
    ok = false
    await openHidden()
    fireEvent.click(screen.getByRole('button', { name: 'Restore The Hunger Games' }))
    await flush(); await flush()
    expect(screen.queryByRole('status')).toBeNull()
    expect(titles()).toEqual(['The Hunger Games'])
    expect(hiddenCount()).toBe('Hidden from For you1')
  })

  it('Undo tapped while the Restore is still on its way: the hide goes after it, and Search hears them in order', async () => {
    let release!: () => void
    const held = new Promise<void>((r) => (release = r))
    const order: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/recommendations/removed') {
        order.push(`${init?.method} sent`)
        if (init?.method === 'DELETE') await held
        order.push(`${init?.method} done`)
        return Response.json({ ok: true })
      }
      return Response.json(DATA)
    }))
    const heard: boolean[] = []
    const on = (e: Event) => heard.push((e as CustomEvent).detail.hidden)
    window.addEventListener('wtw:hidden', on)
    try {
      await openHidden()
      fireEvent.click(screen.getByRole('button', { name: 'Restore The Hunger Games' }))
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
      await flush()
      expect(order).toEqual(['DELETE sent'])
      release()
      await flush(); await flush(); await flush()
      expect(order).toEqual(['DELETE sent', 'DELETE done', 'POST sent', 'POST done'])
      expect(heard).toEqual([false, true])
      expect(titles()).toEqual(['The Hunger Games'])
      expect(hiddenCount()).toBe('Hidden from For you1')
    } finally {
      window.removeEventListener('wtw:hidden', on)
    }
  })

  it('a slow Restore that fails after another row\'s Restore still puts its row back', async () => {
    let fail!: () => void
    const held = new Promise<void>((r) => (fail = r))
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/recommendations/removed') {
        const body = JSON.parse(String(init?.body))
        if (body.tmdb_id === '4') return (await held, new Response('no', { status: 500 }))
        return Response.json({ ok: true })
      }
      return Response.json({ ...DATA, removed: [...DATA.removed, { ...DATA.removed[0], tmdb_id: '5', title: 'Dune', removed_at: '2026-10-01T00:00:00Z' }] })
    }))
    await openHidden()
    fireEvent.click(screen.getByRole('button', { name: 'Restore The Hunger Games' }))
    fireEvent.click(screen.getByRole('button', { name: 'Restore Dune' }))
    await flush()
    expect(hiddenCount()).toBe('Hidden from For you')
    fail()
    await flush(); await flush()
    expect(hiddenCount()).toBe('Hidden from For you1')
    expect(screen.getByRole('button', { name: 'Restore The Hunger Games' })).toBeInTheDocument()
  })

  it('Restore, Undo, Restore again, then the first Restore fails: the row stays restored', async () => {
    let fail!: () => void
    const held = new Promise<void>((r) => (fail = r))
    let deletes = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/recommendations/removed') {
        if (init?.method === 'DELETE' && ++deletes === 1) return (await held, new Response('no', { status: 500 }))
        return Response.json({ ok: true })
      }
      return Response.json(DATA)
    }))
    await openHidden()
    fireEvent.click(screen.getByRole('button', { name: 'Restore The Hunger Games' }))
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Restore The Hunger Games' }))
    fail()
    await flush(); await flush(); await flush(); await flush()
    expect(hiddenCount()).toBe('Hidden from For you')
    expect(screen.getByRole('status')).toHaveTextContent('Restored. The Hunger Games can show up on For you again.')
  })

  it('Search hears both: restored, then hidden again', async () => {
    const heard: unknown[] = []
    const on = (e: Event) => heard.push((e as CustomEvent).detail)
    window.addEventListener('wtw:hidden', on)
    try {
      await openHidden()
      fireEvent.click(screen.getByRole('button', { name: 'Restore The Hunger Games' }))
      await flush()
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
      await flush()
      expect(heard).toEqual([{ id: 'movie:4', hidden: false }, { id: 'movie:4', hidden: true }])
    } finally {
      window.removeEventListener('wtw:hidden', on)
    }
  })
})
