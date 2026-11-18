import { describe, it, expect } from 'vitest'
import { mergeSearch, votePercentile, type CatalogueRow, type VoteQuantiles } from '@/lib/search-catalogue'
import type { SearchHit } from '@/lib/tmdb'

// v3 Q4 (SEARCH.md DEC-6): the catalogue's word-start and typo matches merged
// with TMDB's whole-word answer: best-known first, no doubles, up to six.

// Movies get ~10× the votes of series at the same rank.
const cuts = (top: number) => Array.from({ length: 101 }, (_, i) => Math.round((top * i * i) / 10000))
const Q: VoteQuantiles = { movie: cuts(30000), tv: cuts(3000) }
const row = (id: string, type: 'movie' | 'tv', title: string, votes: number, year: number, first: boolean, similarity: number | null = null): CatalogueRow =>
  ({ tmdb_id: id, type, title, release_year: year, poster_path: null, tmdb_vote_count: votes, first_word: first, similarity })
const tmdbTitle = (id: string, type: 'movie' | 'tv', title: string, votes: number, year = 2010, poster = '/p.jpg'): SearchHit =>
  ({ tmdb_id: id, type, title, year, poster_path: poster, votes })
const person = (id: string, name: string): SearchHit =>
  ({ tmdb_id: id, type: 'person', name, role: 'Actor', profile_path: '/x.jpg', known_for: [] })
const names = (hits: SearchHit[]) => hits.map(h => (h.type === 'person' ? `@${h.name}` : h.title))

describe('votePercentile', () => {
  it('places a vote count among its type', () => {
    expect(votePercentile(Q.tv, 3000)).toBe(1)
    expect(votePercentile([0, 10, 20, 30], 0)).toBe(0.25)          // share of cut points at or below it
    expect(votePercentile(Q.tv, 300)).toBeLessThan(votePercentile(Q.tv, 900))
    expect(votePercentile(Q.tv, 900)).toBeGreaterThan(votePercentile(Q.movie, 900))   // 900 votes is much more for a series
    expect(votePercentile(undefined, 500)).toBe(0)
  })
})

describe('mergeSearch', () => {
  it('a well-known series isn\'t crowded out by films with ten times its votes (votes ranked within type)', () => {
    const rows = [
      row('1', 'movie', 'Slumdog Millionaire', 11000, 2008, true),
      row('2', 'movie', 'Sleepy Hollow', 7400, 1999, true),
      row('3', 'movie', 'Sleepers', 2500, 1996, true),
      row('4', 'movie', 'Sling Blade', 900, 1996, true),
      row('5', 'movie', 'Slither', 1100, 2006, true),
      row('6', 'movie', 'Sleeping Beauty', 1500, 1959, true),
      row('7', 'movie', 'Slow West', 800, 2015, true),
      row('8', 'tv', 'Slow Horses', 880, 2022, true),
      row('9', 'movie', '12 Years a Slave', 12000, 2013, false),
    ]
    const out = names(mergeSearch('sl', [], rows, Q, 2026))
    expect(out).toHaveLength(6)
    expect(out).toContain('Slow Horses')
    expect(out.indexOf('Slumdog Millionaire')).toBeLessThan(out.indexOf('Sling Blade') === -1 ? 99 : out.indexOf('Sling Blade'))
    expect(out).not.toContain('12 Years a Slave')            // a later word ranks after every first-word match
  })

  it('no doubles: a title from both lists appears once, with TMDB\'s poster when ours has none', () => {
    const out = mergeSearch('slow', [tmdbTitle('8', 'tv', 'Slow Horses', 880, 2022, '/sh.jpg')], [row('8', 'tv', 'Slow Horses', 880, 2022, true)], Q, 2026)
    expect(names(out)).toEqual(['Slow Horses'])
    expect(out[0].type !== 'person' && out[0].poster_path).toBe('/sh.jpg')
  })

  it('TMDB\'s whole-word junk ("sl" → "S.L. Film") goes below what starts with the letters', () => {
    const tmdb = [tmdbTitle('100', 'movie', 'S.L. Film', 3), tmdbTitle('101', 'tv', 'Death Inc.', 40)]
    const out = names(mergeSearch('sl', tmdb, [row('8', 'tv', 'Slow Horses', 880, 2022, true)], Q, 2026))
    expect(out[0]).toBe('Slow Horses')
  })

  it('a title only TMDB knows still shows, ranked by its own votes', () => {
    const out = names(mergeSearch('slow', [tmdbTitle('200', 'movie', 'Slow Burn Unknown', 5)], [row('8', 'tv', 'Slow Horses', 880, 2022, true)], Q, 2026))
    expect(out).toEqual(['Slow Horses', 'Slow Burn Unknown'])
  })

  it('a one-word typo: the catalogue\'s close spellings, closest first', () => {
    const rows = [
      row('238', 'movie', 'The Godfather', 23000, 1972, false, 0.43),
      row('240', 'movie', 'The Godfather Part II', 14000, 1974, false, 0.43),
      row('999', 'tv', 'Godfather of Harlem', 300, 2019, false, 0.41),
    ]
    expect(names(mergeSearch('godfahter', [], rows, Q, 2026))[0]).toBe('The Godfather')
  })

  it('people stay where TMDB put them, as today', () => {
    const tmdb = [person('1', 'Samantha Sloyan'), tmdbTitle('8', 'tv', 'Slow Horses', 880, 2022), person('2', 'Barry Sloane')]
    const out = names(mergeSearch('slo', tmdb, [row('8', 'tv', 'Slow Horses', 880, 2022, true), row('7', 'movie', 'Slow West', 800, 2015, true)], Q, 2026))
    expect(out[0]).toBe('@Samantha Sloyan')
    expect(out[2]).toBe('@Barry Sloane')
    expect(out).toContain('Slow Horses')
    expect(out).toContain('Slow West')
  })

  it('up to six', () => {
    const rows = Array.from({ length: 20 }, (_, i) => row(String(i), 'movie', `Sl ${i}`, 100 * i, 2000, true))
    expect(mergeSearch('sl', [], rows, Q, 2026)).toHaveLength(6)
  })

  it('without quantiles (their read failed): still a list, by first word and recency', () => {
    expect(mergeSearch('sl', [], [row('8', 'tv', 'Slow Horses', 880, 2022, true)], {}, 2026)).toHaveLength(1)
  })
})
