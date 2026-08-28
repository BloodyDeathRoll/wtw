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
import { recordKey, recordType, titleKey, type MediaType } from '@/lib/title-key'
import type { DNASchema, DNASignal, SessionSummary } from '@/types/dna'

export async function foldRatedHistoryIntoSummary(
  dna: DNASchema,
  summary: SessionSummary,
): Promise<number> {
  // Dedup on the composite title key across all sources (matches
  // mergeFeedbackSignalsLight): a title signaled from any source must not be
  // double-counted by a rating. Never the bare id — TMDB movie/TV ids collide.
  const signaledKeys = new Set<string>()
  const signaledBare = new Set<string>()
  for (const s of [...dna.signals, ...summary.new_signals]) {
    signaledKeys.add(titleKey(s.type, s.tmdb_id))
    signaledBare.add(s.tmdb_id)
  }

  const pending = dna.learning_loop.recommendation_history.filter((h) => {
    if (h.rating == null) return false
    // Legacy row (no type): any same-id signal counts — can't tell which title.
    if (!recordType(h)) return !signaledBare.has(h.tmdb_id)
    return !signaledKeys.has(recordKey(h))
  })
  if (pending.length === 0) return 0

  // Resolve title from the catalog by (tmdb_id, type). Both rows of a colliding
  // id come back; pick by the type the history row was written with.
  const db = createServiceClient()
  const { data: titleRows } = await db
    .from('titles')
    .select('tmdb_id, title, type')
    .in('tmdb_id', [...new Set(pending.map((h) => h.tmdb_id))])
  const rows = (titleRows ?? []) as { tmdb_id: string; title: string; type: MediaType }[]
  const byKey = new Map(rows.map((t) => [titleKey(t.type, t.tmdb_id), t]))

  let folded = 0
  for (const h of pending) {
    const type = recordType(h)
    const t = type
      ? byKey.get(titleKey(type, h.tmdb_id))
      : (() => { const same = rows.filter((r) => r.tmdb_id === h.tmdb_id); return same.length === 1 ? same[0] : undefined })()
    if (!t) continue // not in catalog, or an ambiguous legacy id — nothing safe to score against

    const signal: DNASignal = {
      title: t.title,
      tmdb_id: h.tmdb_id,
      type: t.type,
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
    signaledKeys.add(titleKey(t.type, h.tmdb_id))
    signaledBare.add(h.tmdb_id)
    folded++
  }
  return folded
}
