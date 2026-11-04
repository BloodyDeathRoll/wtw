import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { leadCast, searchTitles } from '@/lib/tmdb'

// Menu → Search's list (src/lib/tmdb.ts searchTitles): TMDB's relevance order
// is re-ranked so the title someone typed comes first, and noise is dropped.

function tmdbReturns(results: unknown[]) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ results }), { status: 200 })))
}

beforeEach(() => { process.env.TMDB_API_KEY = 'test' })
afterEach(() => { vi.unstubAllGlobals() })

describe('searchTitles', () => {
  it('puts the exact title first, then titles starting with the query, better-known first', async () => {
    tmdbReturns([
      { id: 1, media_type: 'tv', name: 'Slow Boat Home', first_air_date: '2013-01-01', poster_path: '/a.jpg', vote_count: 5 },
      { id: 2, media_type: 'movie', title: 'Run Home Slow', release_date: '1965-01-01', poster_path: '/b.jpg', vote_count: 900 },
      { id: 3, media_type: 'tv', name: 'Slow Horses', first_air_date: '2022-04-01', poster_path: '/c.jpg', vote_count: 880 },
      { id: 4, media_type: 'movie', title: 'Slow West', release_date: '2015-01-01', poster_path: '/d.jpg', vote_count: 1063 },
    ])
    const hits = await searchTitles('slow horses')
    expect(hits.map(h => h.title)).toEqual(['Slow Horses', 'Slow West', 'Run Home Slow', 'Slow Boat Home'])

    tmdbReturns([
      { id: 1, media_type: 'tv', name: 'Slow Boat Home', first_air_date: '2013-01-01', poster_path: '/a.jpg', vote_count: 5 },
      { id: 3, media_type: 'tv', name: 'Slow Horses', first_air_date: '2022-04-01', poster_path: '/c.jpg', vote_count: 880 },
      { id: 4, media_type: 'movie', title: 'Slow West', release_date: '2015-01-01', poster_path: '/d.jpg', vote_count: 1063 },
    ])
    expect((await searchTitles('slow')).map(h => h.title)).toEqual(['Slow West', 'Slow Horses', 'Slow Boat Home'])
  })

  it('matches across accents and punctuation (Shōgun, Se7en)', async () => {
    tmdbReturns([
      { id: 9, media_type: 'tv', name: 'Abarenbo Shogun', poster_path: '/x.jpg', vote_count: 50 },
      { id: 8, media_type: 'tv', name: 'Shōgun', first_air_date: '2024-02-27', poster_path: '/s.jpg', vote_count: 40 },
    ])
    expect((await searchTitles('shogun'))[0].title).toBe('Shōgun')
  })

  it('drops people, and titles with neither a poster nor a few votes', async () => {
    tmdbReturns([
      { id: 5, media_type: 'person', name: 'Slow Person' },
      { id: 6, media_type: 'movie', title: 'Slow Hours', release_date: '2026-01-01', poster_path: null, vote_count: 0 },
      { id: 7, media_type: 'movie', title: 'Slow', release_date: '', poster_path: null, vote_count: 49 },
    ])
    const hits = await searchTitles('slow')
    expect(hits).toEqual([{ tmdb_id: '7', type: 'movie', title: 'Slow', year: null, poster_path: null }])
  })

  it('asks TMDB nothing for an empty query', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    expect(await searchTitles('   ')).toEqual([])
    expect(f).not.toHaveBeenCalled()
  })
})

describe('leadCast', () => {
  it('gives the two top-billed actors per title, and skips a title whose lookup fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/movie/1900/')) {
        return new Response(JSON.stringify({ cast: [
          { name: 'Benicio del Toro', order: 1 }, { name: 'Michael Douglas', order: 0 }, { name: 'Don Cheadle', order: 2 },
        ] }), { status: 200 })
      }
      if (url.includes('/tv/7/')) return new Response(JSON.stringify({ cast: [] }), { status: 200 })
      return new Response('boom', { status: 500 })
    }))
    expect(await leadCast([
      { type: 'movie', tmdb_id: '1900' }, { type: 'tv', tmdb_id: '7' }, { type: 'movie', tmdb_id: '9' },
    ])).toEqual({ 'movie-1900': 'Michael Douglas, Benicio del Toro', 'tv-7': '' })
  })
})
