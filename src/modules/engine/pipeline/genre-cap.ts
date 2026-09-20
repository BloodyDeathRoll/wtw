/**
 * Genre-share cap for the narrative candidate pool.
 *
 * Why (2026-09-06, measured): the catalog is 20% horror (movies) / 19% anime
 * (TV) because the grow sweep gives every genre an equal slice. The narrative
 * pool is "the 150 nearest titles to the fingerprint vector", so it inherits
 * that skew and amplifies it — measured pools ran 25–44% horror and 19–36%
 * anime across three users, including one whose fingerprint reads warm and
 * hopeful. Composite WEIGHTS cannot undo it: narrative score is a percentile
 * *within the pool*, so a 40% horror pool yields a 40% horror batch whatever
 * the weights say.
 *
 * The cap is on the POOL, not the batch. A capped genre still supplies
 * ~37 of 150 candidates competing for 50 slots, so a user who genuinely loves
 * horror still gets horror — the scorer just has something else to choose
 * from. The line is drawn at the catalog's own share: the pool may be as
 * skewed as the catalog, never more.
 *
 * "anime" is not a TMDB genre, so it is counted as a bucket of its own using
 * the same definition the exclusion rules use (keyword `anime`, or Animation
 * + Japanese) — otherwise the one skew the users actually complained about is
 * the one the cap cannot see.
 */

import { matchesRule, type MatchableTitle } from '@/lib/exclusion-rules'
import type { ExclusionRule } from '@/types/dna'

/**
 * Maximum share of the pool any one bucket may hold. 0.25 sits just above the
 * catalog's natural 20% horror / 19% anime share, so the cap only ever fires
 * on amplification, never on the catalog's own composition.
 */
export const GENRE_SHARE_CAP = 0.25

/**
 * How many rows to ask the RPC for, as a multiple of the pool size we keep.
 * The cap can only rebalance what it was handed: at a 44% skew, filling 150
 * with ≤37 of the dominant bucket needs ~200 rows, and several buckets can
 * bind at once (a horror-thriller counts against both).
 */
export const NARRATIVE_OVERFETCH = 3

const ANIME_RULE: ExclusionRule = {
  type: 'keyword', id: '', name: 'anime', raw: 'anime', reason: '',
}

/** The buckets a title is counted against — its genres, plus `anime` if it is one. */
export function genreBuckets(title: MatchableTitle): string[] {
  const genres = (title.genres ?? []).map(g => g.name.trim().toLowerCase()).filter(Boolean)
  return matchesRule(title, ANIME_RULE) ? [...genres, 'anime'] : genres
}

/**
 * Take `limit` rows in the order given, skipping any row that would push one
 * of its buckets over `cap`.
 *
 * The pool must never come back smaller than it would have been uncapped —
 * 150 nearest neighbours cut to 38 cards is a worse batch than a skewed one.
 * So when the cap leaves it short (the pool genuinely has nothing else to
 * offer), the ceiling is raised by one full allowance and the skipped rows are
 * walked again. Every bucket gains the same room each round, so a short pool
 * degrades toward proportional rather than handing the whole remainder back to
 * whichever genre happened to be nearest.
 *
 * @param rows  candidates in relevance order (nearest first)
 */
export function capGenreShare<T extends MatchableTitle>(
  rows: readonly T[],
  limit: number,
  cap: number = GENRE_SHARE_CAP,
): T[] {
  if (rows.length <= limit) return [...rows]

  const allowance = Math.max(1, Math.ceil(limit * cap))
  const bucketsOf = new Map<T, string[]>(rows.map(r => [r, genreBuckets(r)]))
  const counts = new Map<string, number>()
  const kept: T[] = []
  let pending: T[] = [...rows]

  for (let ceiling = allowance; kept.length < limit && pending.length > 0; ceiling += allowance) {
    const deferred: T[] = []
    for (const row of pending) {
      const buckets = bucketsOf.get(row)!
      if (kept.length >= limit || buckets.some(b => (counts.get(b) ?? 0) >= ceiling)) {
        deferred.push(row)
        continue
      }
      for (const b of buckets) counts.set(b, (counts.get(b) ?? 0) + 1)
      kept.push(row)
    }
    pending = deferred
  }
  return kept
}
