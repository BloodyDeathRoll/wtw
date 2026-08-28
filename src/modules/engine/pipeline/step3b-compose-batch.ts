/**
 * Step 3b — Compose the batch: 80% fresh, 20% previously served
 *
 * Decided 2026-08-28 (docs/INTEGRATION.md §7): each batch of BATCH_SIZE is
 * 80% titles this user has never been served and 20% titles served before but
 * never rated, both ordered by match. Step 1 tags each candidate with
 * `previously_served`; step 3 has already sorted everything by composite
 * score. This picks the top of each side, backfills from the other when one
 * side is short (a new user has no served titles; a heavy user may have a
 * thin fresh pool for a session-level filter), and hands the merged batch —
 * again in score order — to the LLM rerank.
 *
 * Pure function — unit-tested in tests/unit/compose-batch.test.ts.
 */

import type { ScoredTitle } from '../types'

export const BATCH_SIZE  = 50
export const FRESH_SHARE = 0.8

export function composeBatch(
  sorted: ScoredTitle[],
  size: number = BATCH_SIZE,
  freshShare: number = FRESH_SHARE,
): ScoredTitle[] {
  if (sorted.length <= size) return sorted

  const fresh = sorted.filter(s => !s.title.previously_served)
  // Seen slice: least-served first, then by score — otherwise the ten
  // highest-scoring served titles are the same ten at the top of every batch
  // until they're rated (seen live 2026-08-28), which is the repetition this
  // whole change exists to remove. The final sort below still orders the
  // batch by match; this only decides WHICH seen titles get the slots.
  const seen  = sorted
    .filter(s => s.title.previously_served)
    .sort((a, b) =>
      (a.title.times_served ?? 1) - (b.title.times_served ?? 1) ||
      b.composite_score - a.composite_score)

  const freshTarget = Math.round(size * freshShare)
  const seenTarget  = size - freshTarget

  // Take each side's quota, then let whichever side has more left fill the gap.
  const freshTake = Math.min(fresh.length, freshTarget + Math.max(0, seenTarget - seen.length))
  const seenTake  = Math.min(seen.length,  size - freshTake)

  return [...fresh.slice(0, freshTake), ...seen.slice(0, seenTake)]
    .sort((a, b) => b.composite_score - a.composite_score)
}
