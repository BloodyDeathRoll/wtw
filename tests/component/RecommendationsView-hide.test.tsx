import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import RecommendationsView from '@/modules/session/recommendations/RecommendationsView'
import { HIDDEN_EVENT, type HiddenDetail } from '@/modules/session/recommendations/rate'
import type { Recommendation, RecPage } from '@/types/recommendation'

// v3 F3 (FOR-YOU.md DEC-5, docs/prototypes/for-you-v3/2-hide.jpg): under FOR_YOU_V3 the X becomes "Hide", and the
// card folds into a note with Undo in its place. Flag off, today's X.

const card = (n: number): Recommendation => ({
  id: `movie:${n}`, title: `Title ${n}`, type: 'movie', year: 2020, poster_url: null, meta: '1h 40m',
  rating: 7, match: 0.8, reason: 'r', where: null, motif: 'dot', palette: ['#000', '#fff'],
})
const pageOf = (ns: number[]): RecPage => ({
  recommendations: ns.map(card), next_offset: ns.length, has_more: false, source: 'cache', taste_version: 7,
})

let fetchMock: ReturnType<typeof vi.fn>
let removedOk = true
beforeEach(() => {
  localStorage.clear()
  removedOk = true
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} unobserve() {} })
  Element.prototype.scrollTo = () => {}
  fetchMock = vi.fn(async (url: string) =>
    String(url).startsWith('/api/recommendations/removed')
      ? new Response(JSON.stringify(removedOk ? { ok: true } : { error: 'x' }), { status: removedOk ? 200 : 500 })
      : new Response(JSON.stringify(pageOf([1, 2]))),
  )
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  // Unmount first: an effect still settling after the test (the list's paging observer) must not run after the
  // IntersectionObserver stub is gone (seen once in CI, 2026-11-22).
  cleanup()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

/** The writes to removed_titles, in the order they were sent. */
const removedCalls = () =>
  fetchMock.mock.calls
    .filter(([url]) => String(url).startsWith('/api/recommendations/removed'))
    .map(([, init]) => `${(init as RequestInit).method} ${(init as RequestInit).body}`)

const NOTE = /Hidden\. You won’t see/

describe('<RecommendationsView /> Hide (v3 F3)', () => {
  it('flag off: the X, as today', async () => {
    render(<RecommendationsView onBack={() => {}} contentType="movies" />)
    await screen.findByText('Title 1')
    expect(screen.getByRole('button', { name: 'Not for me: never recommend Title 1 again' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Hide' })).toBeNull()
  })

  it('flag on: Hide folds the card into the note, Undo brings it back, Hide again; each lands in order', async () => {
    vi.stubEnv('FOR_YOU_V3', 'true')
    // Search's marks listen for these (rate.ts): every hide and restore must say so once it lands.
    const heard: string[] = []
    const onHidden = (e: Event) => heard.push(`${(e as CustomEvent<HiddenDetail>).detail.id} ${(e as CustomEvent<HiddenDetail>).detail.hidden}`)
    window.addEventListener(HIDDEN_EVENT, onHidden)
    render(<RecommendationsView onBack={() => {}} contentType="movies" />)
    await screen.findByText('Title 1')
    expect(screen.queryByRole('button', { name: /Not for me/ })).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Hide' })).toHaveLength(2)

    fireEvent.click(screen.getAllByRole('button', { name: 'Hide' })[0])
    const note = screen.getByRole('status')
    expect(note.textContent).toBe('Hidden. You won’t see Title 1 again.Your taste isn’t changed.Undo')
    expect(note.querySelector('b')?.textContent).toBe('Title 1')
    expect(screen.queryByRole('heading', { name: 'Title 1' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Title 2' })).toBeTruthy() // the next card is still there, below

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.queryByText(NOTE)).toBeNull()
    expect(screen.getByRole('heading', { name: 'Title 1' })).toBeTruthy()

    fireEvent.click(screen.getAllByRole('button', { name: 'Hide' })[0])
    expect(screen.getByText(NOTE)).toBeTruthy()

    const post = 'POST {"tmdb_id":"1","media_type":"movie","title":"Title 1"}'
    await waitFor(() =>
      expect(removedCalls()).toEqual([post, 'DELETE {"tmdb_id":"1","media_type":"movie"}', post]),
    )
    await waitFor(() => expect(heard).toEqual(['movie:1 true', 'movie:1 false', 'movie:1 true']))
    window.removeEventListener(HIDDEN_EVENT, onHidden)
    // The note keeps the card's place while this list is on screen.
    expect(screen.getByText(NOTE)).toBeTruthy()
  })

  it('a hide that fails puts the card back; an Undo that fails puts the note back', async () => {
    vi.stubEnv('FOR_YOU_V3', 'true')
    render(<RecommendationsView onBack={() => {}} contentType="movies" />)
    await screen.findByText('Title 1')

    removedOk = false
    fireEvent.click(screen.getAllByRole('button', { name: 'Hide' })[0])
    expect(screen.getByText(NOTE)).toBeTruthy()
    await waitFor(() => expect(screen.queryByText(NOTE)).toBeNull())
    expect(screen.getByRole('heading', { name: 'Title 1' })).toBeTruthy()

    removedOk = true
    fireEvent.click(screen.getAllByRole('button', { name: 'Hide' })[0])
    await waitFor(() => expect(removedCalls()).toHaveLength(2))
    removedOk = false
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.queryByText(NOTE)).toBeNull()
    await screen.findByText(NOTE)
  })
})
