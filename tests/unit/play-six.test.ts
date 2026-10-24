import { describe, it, expect } from 'vitest'
import { freshState, prepareTitles } from '@/app/play/lib/brain'
import type { GameTitle } from '@/app/play/lib/scales'
import {
  markSixServed, sixDeal, sixFilmHint, sixPlaceHint, sixPoints, sixRight, sixRoles, sixStart, type SixChain,
} from '@/app/play/lib/six'
import chains from '@/app/play/data/six-chains.json'
import titlesJson from '@/app/play/data/titles.json'

function seeded(seed = 7) {
  return () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
}

let n = 0
function chain(actorIds: number[], filmIds: string[], roles?: string[][]): SixChain {
  n++
  return {
    id: `six:${n}`,
    actors: actorIds.map((id, k) => ({ id, name: `Actor ${id}`, img: null, roles: roles?.[k] ?? (k === 0 || k === 5 ? ['A'] : ['A', 'B']) })),
    films: filmIds.map((id, k) => ({ id, title: `Film ${k}`, year: 2000, poster: null })),
  }
}
const film = (id: string, genres: GameTitle['genres'] = ['drama']) => ({
  id, tmdb_id: id, type: 'movie', title: id, year: 2000, poster_path: null, overview: '', creators: [], runtime: 100,
  collection: null, groups: [], trailer_key: null, where: null, characters: [], keywords: [], aliases: [], seasons: null, episodes: null,
  votes: 1000, rating: 7, pop: 0.5, scales: { tone: 0, energy: 0, pace: 0, dark: 0, complex: 0, fantastic: 0, modern: 0, indie: 0 }, genres, never: genres,
}) as unknown as GameTitle

describe('Six Degrees', () => {
  it('deals a board with the ends fixed and nobody in the middle in their right spot', () => {
    const c = chain([1, 2, 3, 4, 5, 6], ['f1', 'f2', 'f3', 'f4', 'f5'])
    const r = seeded()
    for (let k = 0; k < 50; k++) {
      const b = sixStart(c, r)
      expect(b[0]).toBe(0); expect(b[5]).toBe(5)
      expect([...b].sort()).toEqual([0, 1, 2, 3, 4, 5])
      expect(sixRight(b)).toEqual([])
    }
    expect(sixRight([0, 1, 3, 2, 4, 5])).toEqual([1, 4])
  })

  it('never deals a chain twice, skips "Never" genres, and keeps faces and films from recent chains away', () => {
    const T = prepareTitles(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'i', 'j', 'k'].map(id => film(id)).concat(film('h', ['horror'])))
    const S = freshState(); S.gen.horror = -9
    const scary = chain([1, 2, 3, 4, 5, 6], ['a', 'b', 'c', 'd', 'h'])
    const first = chain([10, 11, 12, 13, 14, 15], ['a', 'b', 'c', 'd', 'e'])
    const sameFace = chain([10, 21, 22, 23, 24, 25], ['a', 'b', 'c', 'd', 'e'])
    const fresh = chain([31, 32, 33, 34, 35, 36], ['f', 'g', 'i', 'j', 'k'])
    const sameFilm = chain([41, 42, 43, 44, 45, 46], ['a', 'x1', 'x2', 'x3', 'x4'])
    markSixServed(S, first)
    for (let k = 0; k < 20; k++) expect(sixDeal(S, [scary, first, sameFace, sameFilm, fresh], T, seeded(k))).toBe(fresh)
    markSixServed(S, fresh); markSixServed(S, sameFace); markSixServed(S, sameFilm)
    expect(sixDeal(S, [scary, first, sameFace, sameFilm, fresh], T)).toBeNull()
  })

  it('shows films the player has not been shown, links they have not solved first, then places an actor', () => {
    expect(sixFilmHint(new Set(), [])).toBe(2)
    expect(sixFilmHint(new Set([2, 3]), [])).toBe(1)          // link 2 joins two green actors: they know it
    expect(sixFilmHint(new Set(), [2, 1, 3, 0])).toBe(4)
    expect(sixFilmHint(new Set(), [0, 1, 2, 3, 4])).toBeNull()
    const placed = sixPlaceHint([0, 3, 1, 4, 2, 5], new Set())!
    expect(placed.spot).toBe(1)
    expect(placed.board).toEqual([0, 1, 3, 4, 2, 5])
    expect(sixPlaceHint([0, 1, 2, 3, 4, 5], new Set([1, 2, 3, 4]))).toBeNull()
  })

  it('scores 5 for a first-check solve; extra checks and hints cost one each, a solve keeps at least 1', () => {
    expect(sixPoints(1, 0)).toBe(5)
    expect(sixPoints(3, 1)).toBe(2)
    expect(sixPoints(4, 4)).toBe(1)
  })

  it('tags each role with a direction, merges one character played twice, and shortens double names', () => {
    const c = chain([1, 2, 3, 4, 5, 6], ['f1', 'f2', 'f3', 'f4', 'f5'],
      [['Rick Deckard'], ['Diana', 'Diana Prince / Wonder Woman'], ['Lieutenant Joshi', 'Antiope'], ['Ian Donnelly', 'Clint Barton / Hawkeye'], ['Lois', 'Louise Banks'], ['Thor']])
    expect(sixRoles(c, 0)).toEqual([{ dir: '↓', name: 'Rick Deckard', full: 'Rick Deckard' }])
    expect(sixRoles(c, 1)).toEqual([{ dir: '↕', name: 'Wonder Woman', full: 'Diana Prince / Wonder Woman' }])
    expect(sixRoles(c, 3).map(r => `${r.dir}${r.name}`)).toEqual(['↑Ian Donnelly', '↓Hawkeye'])
    expect(sixRoles(c, 5).map(r => r.dir)).toEqual(['↑'])
  })
})

describe('Six Degrees chains (data/six-chains.json)', () => {
  const titles = new Map((titlesJson as GameTitle[]).map(t => [t.id, t]))
  const all = chains as SixChain[]

  it('hold six different actors and five different films from the game\'s titles, with a role per film', () => {
    expect(all.length).toBeGreaterThanOrEqual(12)
    // variety: a link (pair + film) once in the whole set, a film in at most two chains, a face in at most three
    const links = all.flatMap(c => c.films.map((f, k) => `${[c.actors[k].id, c.actors[k + 1].id].sort().join('-')}@${f.id}`))
    expect(new Set(links).size).toBe(links.length)
    const count = (xs: (string | number)[]) => Math.max(...Object.values(xs.reduce<Record<string, number>>((m, x) => ({ ...m, [x]: (m[x] ?? 0) + 1 }), {})))
    expect(count(all.flatMap(c => c.films.map(f => f.id)))).toBeLessThanOrEqual(2)
    expect(count(all.flatMap(c => c.actors.map(a => a.id)))).toBeLessThanOrEqual(3)
    const bad = all.filter(c =>
      c.actors.length !== 6 || new Set(c.actors.map(a => a.id)).size !== 6 ||
      c.films.length !== 5 || new Set(c.films.map(f => f.id)).size !== 5 || c.films.some(f => !titles.has(f.id)) ||
      c.actors.some((a, k) => a.roles.length !== (k === 0 || k === 5 ? 1 : 2) || a.roles.some(r => !r.trim())))
    expect(bad.map(c => c.id)).toEqual([])
    expect(new Set(all.map(c => c.id)).size).toBe(all.length)
  })
})
