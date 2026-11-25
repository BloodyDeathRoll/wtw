/**
 * Keeps `learning_loop.recommendation_history` from growing without end (#375, Eran's rule, 2026-11-25).
 *
 * Every rating appends a row and nothing ever removed one: the largest account carried 1,046 rows
 * (140 KB of an 805 KB DNA), loaded on every feed build and every rating. Kept:
 *   1. every Watchlist marker (`isSavedMarker`): the feed's saved-title exclusion reads them;
 *   2. every rated row whose title isn't in `dna.signals` yet: the session-end fold
 *      (merge-feedback-signal.ts / feedback-signals.ts) is the backstop for a per-click merge that failed;
 *   3. the latest HISTORY_KEEP_OTHER other rows (the recent lookups use `findLast`).
 * Older rows beyond that, mostly ratings already folded into `dna.signals`, go.
 *
 * Applied by saveDNA / saveDNAIfUnchanged on every write, so it rides on writes that already follow
 * their own taste_version rules: trimming history changes no taste, and a bump per click would restart
 * the feed's paging (unrate.ts). Known edge, accepted by Eran: un-rating a title whose old row was
 * trimmed skips the history step; its signal is still removed.
 */
import type { DNASchema } from '@/types/dna'
import { isSavedMarker, recordKey, titleKey } from '@/lib/title-key'

export const HISTORY_KEEP_OTHER = 200

/** Trims `dna` in place. True when it removed anything. */
export function capRecommendationHistory(dna: DNASchema): boolean {
  const history = dna.learning_loop?.recommendation_history
  if (!history || history.length <= HISTORY_KEEP_OTHER) return false

  // Both forms, so a legacy bare-id row matches a typed signal (recordKey gives the bare id for those).
  const folded = new Set<string>()
  for (const s of dna.signals ?? []) {
    folded.add(titleKey(s.type, s.tmdb_id))
    folded.add(s.tmdb_id)
  }

  const keep = new Array<boolean>(history.length).fill(false)
  let others = 0
  for (let i = history.length - 1; i >= 0; i--) {
    const row = history[i]
    if (isSavedMarker(row)) keep[i] = true
    else if (row.rating != null && !folded.has(recordKey(row))) keep[i] = true
    else if (others < HISTORY_KEEP_OTHER) { keep[i] = true; others++ }
  }
  if (keep.every(Boolean)) return false
  dna.learning_loop.recommendation_history = history.filter((_, i) => keep[i])
  return true
}
