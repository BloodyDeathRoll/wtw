/**
 * A genre you turned up never fills more than half the batch (P2-U8, decided
 * with Eran 2026-11-13).
 *
 * Why: More and Much more raise a genre's odds (step3-soft-modifiers.ts). On a
 * genre that is already a big part of the pool that compounds: simulated, a
 * genre that is 40% of the pool reached 67–74% of the batch on Much more, and
 * the feed stops being a mix. The cap keeps "much more" meaning more, not
 * "only".
 *
 * Applied to the batch after it is composed, the way capKidsShare is: the
 * lowest-scoring titles over the limit leave, and the best titles of other
 * kinds take their slots (fresh first, as composeBatch prefers).
 */

import { matchesSoftSignal } from '@/lib/exclusion-rules'
import { turnedUpGenres } from '@/lib/genre-calls'
import type { DNASchema } from '@/types/dna'
import type { ScoredTitle } from '../types'

export const TURNED_UP_SHARE = 0.5

export function capTurnedUp<T extends ScoredTitle>(
  batch: T[],
  pool: T[],
  dna: DNASchema,
  share: number = TURNED_UP_SHARE,
): T[] {
  const genres = turnedUpGenres(dna.contextual_logic.soft_preferences)
  if (genres.length === 0) return batch

  const limit = Math.floor(batch.length * share)
  const isG = (s: T, g: string) => matchesSoftSignal(s.title, '', { genre16: g })
  const byScore = (a: T, b: T) => b.composite_score - a.composite_score
  let out = batch
  for (const g of genres) {
    const members = out.filter(s => isG(s, g))
    if (members.length <= limit) continue
    const drop = new Set(members.sort(byScore).slice(limit))
    const inBatch = new Set(out)
    const fill = pool
      .filter(s => !inBatch.has(s) && !isG(s, g))
      .sort((a, b) => Number(!!a.title.previously_served) - Number(!!b.title.previously_served) || byScore(a, b))
      .slice(0, drop.size)
    out = [...out.filter(s => !drop.has(s)), ...fill].sort(byScore)
  }
  return out
}
