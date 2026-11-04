import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { leadCast, personTitles, searchTitles } from '@/lib/tmdb'

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

  it('ignores a leading "The", and lists titles nobody knows after the known ones (lowdown)', async () => {
    tmdbReturns([
      { id: 1, media_type: 'tv', name: 'The Lowdown', first_air_date: '2025-09-23', poster_path: '/a.jpg', vote_count: 82 },
      { id: 2, media_type: 'tv', name: 'Lowdown', first_air_date: '2010-01-01', poster_path: '/b.jpg', vote_count: 4 },
      { id: 3, media_type: 'movie', title: 'Sweet and Lowdown', release_date: '1999-12-03', poster_path: '/c.jpg', vote_count: 588 },
      { id: 4, media_type: 'movie', title: 'Lowdown Dirty Criminals', release_date: '2020-01-01', poster_path: '/d.jpg', vote_count: 14 },
    ])
    expect((await searchTitles('lowdown')).map(h => h.title))
      .toEqual(['The Lowdown', 'Lowdown Dirty Criminals', 'Sweet and Lowdown', 'Lowdown'])
  })

  describe('when TMDB finds nothing, it asks again with each word left out', () => {
    /** TMDB stand-in: answers by the exact query it is asked. */
    function tmdbAnswers(byQuery: Record<string, unknown[]>) {
      const f = vi.fn(async (url: string) => {
        const q = new URL(url).searchParams.get('query') ?? ''
        return new Response(JSON.stringify({ results: byQuery[q] ?? [] }), { status: 200 })
      })
      vi.stubGlobal('fetch', f)
      return f
    }
    const planes = { id: 2609, media_type: 'movie', title: 'Planes, Trains and Automobiles', release_date: '1987-11-25', poster_path: '/p.jpg', vote_count: 2100 }
    const bhc = { id: 90, media_type: 'movie', title: 'Beverly Hills Cop', release_date: '1984-12-05', poster_path: '/b.jpg', vote_count: 4821 }

    it('finds a title with one misspelt word (plains trains and automobiles)', async () => {
      const f = tmdbAnswers({
        'trains and automobiles': [planes],
        // Results nothing like what was typed are dropped.
        'plains trains and': [{ id: 7, media_type: 'movie', title: 'Plains', release_date: '2020-01-01', poster_path: '/x.jpg', vote_count: 30 }],
      })
      expect((await searchTitles('plains trains and automobiles')).map(h => h.title)).toEqual(['Planes, Trains and Automobiles'])
      expect(f).toHaveBeenCalledTimes(5) // the search, then one per word
    })

    it('finds a title typed with an extra "The" (the beverly hills cop)', async () => {
      tmdbAnswers({ 'beverly hills cop': [bhc], 'the hills cop': [bhc] })
      expect(await searchTitles('the beverly hills cop')).toEqual([
        { tmdb_id: '90', type: 'movie', title: 'Beverly Hills Cop', year: 1984, poster_path: '/b.jpg' },
      ])
    })

    it('still answers when one of the retries fails', async () => {
      vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        const q = new URL(url).searchParams.get('query')
        if (q === 'beverly hills cop') return new Response(JSON.stringify({ results: [bhc] }), { status: 200 })
        if (q === 'the beverly cop') return new Response('boom', { status: 500 })
        return new Response(JSON.stringify({ results: [] }), { status: 200 })
      }))
      expect((await searchTitles('the beverly hills cop')).map(h => h.title)).toEqual(['Beverly Hills Cop'])
    })

    it('does not retry a one-word search, or one TMDB answered', async () => {
      const f = tmdbAnswers({ 'beverly hills cop': [bhc] })
      expect(await searchTitles('shtisle')).toEqual([])
      expect(await searchTitles('beverly hills cop')).toHaveLength(1)
      expect(f).toHaveBeenCalledTimes(2)
    })
  })

  it('asks TMDB nothing for an empty query', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    expect(await searchTitles('   ')).toEqual([])
    expect(f).not.toHaveBeenCalled()
  })
})

describe('searchTitles with people (2026-11-05)', () => {
  const christopher = {
    id: 525, media_type: 'person', name: 'Christopher Nolan', known_for_department: 'Directing', popularity: 8.2,
    profile_path: '/cn.jpg',
    known_for: [{ title: 'Interstellar', vote_count: 41781 }, { title: 'Inception', vote_count: 40647 }, { title: 'The Dark Knight', vote_count: 37217 }, { title: 'Memento', vote_count: 17000 }],
  }

  it('lists directors and actors among the titles, a last name counting as a match', async () => {
    tmdbReturns([
      christopher,
      { id: 2, media_type: 'movie', title: 'Facing Nolan', release_date: '2022-05-24', poster_path: '/f.jpg', vote_count: 25 },
      { id: 19508, media_type: 'person', name: 'Nolan North', known_for_department: 'Acting', popularity: 2.3, profile_path: '/nn.jpg',
        known_for: [{ name: 'Young Justice', vote_count: 1200 }] },
      // Not a director or actor, no photo, or nobody: left out.
      { id: 527, media_type: 'person', name: 'Jonathan Nolan', known_for_department: 'Writing', popularity: 1.8, profile_path: '/jn.jpg', known_for: [] },
      { id: 9, media_type: 'person', name: 'Ann Nolan', known_for_department: 'Acting', popularity: 3, profile_path: null, known_for: [] },
      { id: 8, media_type: 'person', name: 'Bob Nolan', known_for_department: 'Acting', popularity: 0.4, profile_path: '/b.jpg', known_for: [] },
    ])
    const hits = await searchTitles('nolan', 6, { people: true })
    expect(hits.map(h => (h.type === 'person' ? h.name : h.title))).toEqual(['Christopher Nolan', 'Nolan North', 'Facing Nolan'])
    expect(hits[0]).toEqual({
      tmdb_id: '525', type: 'person', name: 'Christopher Nolan', role: 'Director', profile_path: '/cn.jpg',
      known_for: ['Interstellar', 'Inception', 'The Dark Knight'],
    })
  })

  it('ranks people by their own fame, three at most, and a last name as their exact name', async () => {
    const actor = (id: number, name: string, popularity: number) => ({
      id, media_type: 'person', name, known_for_department: 'Acting', popularity, profile_path: `/${id}.jpg`,
      // A bit part in a huge film doesn't make someone famous.
      known_for: [{ title: 'Interstellar', vote_count: 41781 }],
    })
    tmdbReturns([
      { id: 1, media_type: 'movie', title: 'Spielberg', release_date: '2017-10-07', poster_path: '/s.jpg', vote_count: 220 },
      { ...christopher, id: 488, name: 'Steven Spielberg', popularity: 5 },
      actor(2, 'Flora Spielberg', 1.6), actor(3, 'Anne Spielberg', 1.2), actor(4, 'Sasha Spielberg', 2.4),
    ])
    const hits = await searchTitles('spielberg', 6, { people: true })
    expect(hits.map(h => (h.type === 'person' ? h.name : h.title)))
      .toEqual(['Steven Spielberg', 'Sasha Spielberg', 'Flora Spielberg', 'Spielberg'])
  })

  it('leaves people out unless asked', async () => {
    tmdbReturns([christopher])
    expect(await searchTitles('nolan')).toEqual([])
  })
})

describe('personTitles', () => {
  function personIs(person: unknown) {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(person), { status: 200 })))
  }
  const film = (id: number, title: string, date: string, extra: Record<string, unknown> = {}) =>
    ({ id, media_type: 'movie', title, release_date: date, poster_path: `/${id}.jpg`, vote_count: 500, genre_ids: [18], ...extra })

  it("a director: the films they directed, newest first", async () => {
    personIs({
      id: 525, name: 'Christopher Nolan', known_for_department: 'Directing', profile_path: '/cn.jpg',
      combined_credits: {
        cast: [film(1, 'Cameo', '2015-01-01', { character: 'Man' })],
        crew: [
          film(77, 'Memento', '2000-10-11', { job: 'Director' }),
          film(1368337, 'The Odyssey', '2026-07-15', { job: 'Director' }),
          film(155, 'The Dark Knight', '2008-07-16', { job: 'Director' }),
          film(155, 'The Dark Knight', '2008-07-16', { job: 'Writer' }),
          film(3, 'Produced Only', '2019-01-01', { job: 'Producer' }),
          film(4, 'Making Of', '2021-01-01', { job: 'Director', genre_ids: [99] }),
          film(5, 'Tiny Short', '2001-01-01', { job: 'Director', vote_count: 3 }),
        ],
      },
    })
    const page = await personTitles('525')
    expect(page?.role).toBe('Director')
    expect(page?.titles.map(t => `${t.title} ${t.year}`)).toEqual(['The Odyssey 2026', 'The Dark Knight 2008', 'Memento 2000'])
    expect(page?.titles[0]).toEqual({ tmdb_id: '1368337', type: 'movie', title: 'The Odyssey', year: 2026, poster_path: '/1368337.jpg', character: null })
  })

  it('an actor: who they played, without "himself", talk shows or guest spots', async () => {
    personIs({
      id: 3392, name: 'Michael Douglas', known_for_department: 'Acting', profile_path: '/md.jpg',
      combined_credits: {
        cast: [
          film(1900, 'Traffic', '2000-12-27', { character: 'Robert Wakefield' }),
          film(10673, 'Wall Street', '1987-12-11', { character: 'Gordon Gekko' }),
          { id: 197591, media_type: 'tv', name: 'Franklin', first_air_date: '2024-04-12', poster_path: '/fr.jpg', vote_count: 55, genre_ids: [18], character: 'Benjamin Franklin', episode_count: 8 },
          { id: 1668, media_type: 'tv', name: 'Will & Grace', first_air_date: '1998-09-21', poster_path: '/wg.jpg', vote_count: 603, genre_ids: [35], character: 'Gavin', episode_count: 1 },
          { id: 22, media_type: 'tv', name: 'Late Show', first_air_date: '2015-09-08', poster_path: '/ls.jpg', vote_count: 300, genre_ids: [10767], character: 'Guest', episode_count: 6 },
          film(6, 'Tribute', '2010-01-01', { character: 'Himself' }),
        ],
        crew: [],
      },
    })
    const page = await personTitles('3392')
    expect(page?.role).toBe('Actor')
    expect(page?.titles.map(t => `${t.title} as ${t.character}`)).toEqual([
      'Franklin as Benjamin Franklin', 'Traffic as Robert Wakefield', 'Wall Street as Gordon Gekko',
    ])
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
