/**
 * Pick a genre-balanced title set from catalogue candidates.
 *
 * Why not just "the top 500 by votes": measured 2026-10-14, the top 350
 * movies hold 13 horror titles and no documentary at all, and TMDB has no
 * Horror genre for series. A player who loves horror would see almost none.
 * So every genre first gets its own quota (most-voted first), and only then
 * is the set topped up by votes.
 */
import type { GameGenre } from './genres'

export interface SelectCandidate {
  id: string
  votes: number
  /** Game genres the row may belong to (firm + hinted). */
  genres: GameGenre[]
}

export function selectBalanced<T extends SelectCandidate>(
  candidates: T[],
  opts: { perGenre: number; total: number; genres: readonly GameGenre[] },
): T[] {
  const byVotes = [...candidates].sort((a, b) => b.votes - a.votes)
  const chosen: T[] = []
  const chosenIds = new Set<string>()
  const count = new Map<GameGenre, number>(opts.genres.map(g => [g, 0]))
  const cursor = new Map<GameGenre, number>(opts.genres.map(g => [g, 0]))
  const pools = new Map<GameGenre, T[]>(
    opts.genres.map(g => [g, byVotes.filter(c => c.genres.includes(g))]),
  )

  const take = (c: T) => {
    chosen.push(c)
    chosenIds.add(c.id)
    for (const g of c.genres) if (count.has(g)) count.set(g, count.get(g)! + 1)
  }

  // Round-robin over genres, one title per genre per pass, so a genre with a
  // deep pool can't crowd the others out before they get a turn.
  for (let progressed = true; progressed && chosen.length < opts.total; ) {
    progressed = false
    for (const g of opts.genres) {
      if (chosen.length >= opts.total) break
      if (count.get(g)! >= opts.perGenre) continue
      const pool = pools.get(g)!
      let i = cursor.get(g)!
      while (i < pool.length && chosenIds.has(pool[i].id)) i++
      cursor.set(g, i + 1)
      if (i < pool.length) {
        take(pool[i])
        progressed = true
      }
    }
  }

  for (const c of byVotes) {
    if (chosen.length >= opts.total) break
    if (!chosenIds.has(c.id)) take(c)
  }
  return chosen
}
