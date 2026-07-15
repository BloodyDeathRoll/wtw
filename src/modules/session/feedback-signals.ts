/**
 * foldRatedHistoryIntoSummary
 *
 * Converts rated recommendation_history entries (👍/👎 from the rec cards —
 * written by POST /api/recommendations/feedback) into DNASignals on the
 * SessionSummary, so the DNA writer merges them like any other signal.
 *
 * This is what closes the feedback loop at session end / "Find more":
 *   - the reaction feeds crew affinity + visceral strand updates, and
 *   - the title lands in dna.signals, which step1 candidate generation
 *     excludes — so rated titles drop out of the next batch.
 *
 * Ratings are pre-merged into dna.signals at click time by
 * mergeFeedbackSignalsLight (cheap strand math, no version bump), so by the
 * time this runs most rated titles are ALREADY signaled and dedup away to zero
 * here — this fold only catches ratings that couldn't be light-merged (e.g. the
 * title wasn't in the catalog yet). Because the fold can legitimately return 0
 * after rating, session/end must NOT treat "folded 0" as "nothing to do": it
 * separately checks whether the served cache still holds a rated title before
 * skipping regeneration (see the stale-cache guard in session/end/route.ts).
 */

import { createServiceClient } from '@/lib/supabase/service'
import type { DNASchema, DNASignal, SessionSummary } from '@/types/dna'

export async function foldRatedHistoryIntoSummary(
  dna: DNASchema,
  summary: SessionSummary,
): Promise<number> {
  // Dedup on tmdb_id alone (intentional, matches mergeFeedbackSignalsLight):
  // a title signaled from any source must not be double-counted by a rating.
  const alreadySignaled = new Set(dna.signals.map((s) => s.tmdb_id))
  for (const s of summary.new_signals) alreadySignaled.add(s.tmdb_id)

  const pending = dna.learning_loop.recommendation_history.filter(
    (h) => h.rating != null && !alreadySignaled.has(h.tmdb_id),
  )
  if (pending.length === 0) return 0

  // Resolve title + type from the catalog (history stores only tmdb_id).
  const db = createServiceClient()
  const { data: titleRows } = await db
    .from('titles')
    .select('tmdb_id, title, type')
    .in('tmdb_id', pending.map((h) => h.tmdb_id))
  const byId = new Map(
    (titleRows ?? []).map((t) => [t.tmdb_id as string, t]),
  )

  let folded = 0
  for (const h of pending) {
    const t = byId.get(h.tmdb_id)
    if (!t) continue // not in catalog — nothing to score against

    const signal: DNASignal = {
      title: t.title as string,
      tmdb_id: h.tmdb_id,
      type: t.type as 'movie' | 'tv',
      reaction: h.rating!,
      quick_rating: null,
      regret_signal: null,
      source: 'recommendation_accepted',
      reason:
        h.rating === 'disliked'
          ? 'Rejected from a recommendation card'
          : 'Rated on a recommendation card',
      dimensions_reinforced: [],
      dimensions_contradicted: [],
      confidence: 0.75, // explicit click on a shown rec — solid signal
      flag: null,
      watched_at: null,
    }
    summary.new_signals.push(signal)
    folded++
  }
  return folded
}
