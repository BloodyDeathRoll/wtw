import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RatingsView from '@/modules/session/ratings/RatingsView'

// 2026-10-07 (Dream 2026-10-06): a re-rate on "Your ratings" must say which
// list the user is on. Without content_type the feedback route defaults to
// 'all', precomputes an 'all' batch nothing adopts, and on every 5th rating
// promotes it — leaving the Movies/Series feed with nothing cached.

const SUMMARY = {
  counts: { loved: 1, liked: 0, disliked: 0, removed: 0 },
  items: [
    { id: 'movie:603', title: 'The Matrix', rating: 'loved', created_at: '2026-10-01', tmdb_id: '603', media_type: 'movie', poster_url: null },
  ],
  removed: [],
}

describe('<RatingsView /> re-rate', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(SUMMARY), { status: 200 })))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('sends the list the user is on with the new rating', async () => {
    render(<RatingsView onBack={() => {}} contentType="movies" />)
    await screen.findByText('The Matrix')

    await userEvent.click(screen.getByRole('button', { name: /edit the matrix/i }))
    await userEvent.click(screen.getByRole('button', { name: /disliked/i }))

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith('/api/recommendations/feedback', expect.objectContaining({ method: 'POST' })),
    )
    const call = vi.mocked(fetch).mock.calls.find(([url]) => url === '/api/recommendations/feedback')!
    const body = JSON.parse(String((call[1] as RequestInit).body))
    expect(body).toMatchObject({ action: 'watched', reaction: 'disliked', tmdb_id: '603', content_type: 'movies' })
  })
})
