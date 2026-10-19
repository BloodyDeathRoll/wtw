import { beforeEach, describe, expect, it } from 'vitest'
import { getUnsyncedIds, getUnsyncedRemovals, getWatchlist } from '@/lib/watchlist'
import { saveTitle, savedFrom, savedIds, toRecommendation, unsaveTitle } from '@/app/play/lib/watchlist'
import type { GameTitle } from '@/app/play/lib/scales'

const t = (over: Partial<GameTitle> = {}): GameTitle => ({
  id: 'movie:550', tmdb_id: '550', type: 'movie', title: 'Fight Club', year: 1999, poster_path: '/abc.jpg',
  genres: ['drama'], never: ['drama'], overview: 'A plot.', creators: ['David Fincher'], runtime: 139, collection: null,
  characters: [], keywords: [], aliases: [], groups: [], trailer_key: 'xyz', where: 'Netflix', seasons: null, episodes: null,
  votes: 1000, rating: 8.4, pop: 0.9, scales: {}, ...over,
})

describe('saving from the taste games into the live watchlist', () => {
  beforeEach(() => localStorage.clear())

  it('turns a game title into a live card, with no "% match" claim', () => {
    const r = toRecommendation(t(), 'training')
    expect(r.id).toBe('movie:550')
    expect(r.poster_url).toBe('https://image.tmdb.org/t/p/w500/abc.jpg')
    expect(r.trailer_url).toBe('https://www.youtube.com/watch?v=xyz')
    expect(r.meta).toBe('2h 19m')
    expect(r.match).toBe(0)
    expect(toRecommendation(t({ type: 'tv', seasons: 3 }), 'blind').meta).toBe('3 seasons')
  })

  it('lands in the same list as the live app, labelled, and counts as a save (reported at session end)', () => {
    saveTitle(t(), 'knockout')
    const [e] = getWatchlist()
    expect(e.rec.title).toBe('Fight Club')
    expect(savedFrom(e)).toBe('From the Knockout')
    expect(getUnsyncedIds()).toEqual(['movie:550'])
    expect(savedIds().has('movie:550')).toBe(true)
  })

  it('saving twice keeps one entry; removing queues the unsave like the live app', () => {
    saveTitle(t(), 'training')
    saveTitle(t(), 'picks')
    expect(getWatchlist()).toHaveLength(1)
    unsaveTitle('movie:550')
    expect(getWatchlist()).toHaveLength(0)
    expect(getUnsyncedRemovals()).toEqual(['movie:550'])
  })

  it('labels titles saved in the live app as from recommendations', () => {
    const feedCard = { ...toRecommendation(t(), 'picks'), reason: 'Slow-burn crime with a twist ending, like the ones you loved.' }
    localStorage.setItem('wtw_watchlist', JSON.stringify([{ rec: feedCard, added_at: 1, rating: null, explain: null, synced: true }]))
    expect(savedFrom(getWatchlist()[0])).toBe('From recommendations')
  })
})
