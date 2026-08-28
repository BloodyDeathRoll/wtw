/**
 * mergeFeedbackSignalsLight — incremental per-click fingerprint update.
 *
 * Called by POST /api/recommendations/feedback right after a 👍/👎 lands in
 * recommendation_history. Converts any rated-but-unsignaled history entries
 * into DNASignals and applies the CHEAP updates only:
 *   - append signal (dedup vs existing signals)
 *   - Strand A crew affinity + Strand C visceral weights (pure arithmetic)
 *
 * Deliberately NO taste_version bump, NO embedding regen, NO notes rewrite,
 * NO snapshot: bumping per click would invalidate the rec cache the user is
 * actively scrolling (GET falls back to mocks on a version miss), and the
 * LLM/embedding work belongs to session-end. When "Find more" / session-end
 * runs, updateSchemaFromSession bumps once, regenerates the embedding over
 * the accumulated strand changes, and its fold skips everything already
 * signaled here (dedup key: type:tmdb_id + source).
 *
 * Concurrency: callers must serialize invocations per user (the rec UI queues
 * feedback clicks) — this is a read-modify-write on the DNA JSONB.
 */

import type { DNASchema, DNASignal } from '@/types/dna'
import { recordKey, recordType, titleKey } from '@/lib/title-key'
import { loadDNA, saveDNA, fetchTitleCrew, pickTitle } from './lib/load-save'
import { applyCrewAffinityUpdate } from './lib/update-crew'
import { applyStrandCUpdate } from './lib/update-strand-c'

export async function mergeFeedbackSignalsLight(user_id: string): Promise<number> {
  const dna: DNASchema = await loadDNA(user_id)

  // Dedup on the composite title key across ALL sources (NOT key+source like
  // the session merge): if a title is already signaled from any source (e.g.
  // the user praised it in chat), a card rating must not double-count its
  // crew and visceral weights with a second signal. Composite, not bare id —
  // a bare-id set let a same-id TV signal swallow the movie's rating forever.
  const signaled = new Set(dna.signals.map((s) => titleKey(s.type, s.tmdb_id)))
  const pending = dna.learning_loop.recommendation_history.filter((h) => {
    if (h.rating == null) return false
    const type = recordType(h)
    // Legacy row (no type): treat "any signal with this id" as signaled, since
    // we can't tell which title it meant.
    if (!type) return !dna.signals.some((s) => s.tmdb_id === h.tmdb_id)
    return !signaled.has(recordKey(h))
  })
  if (pending.length === 0) return 0

  const titleMap = await fetchTitleCrew(pending.map((h) => h.tmdb_id))

  let merged = 0
  for (const h of pending) {
    const title = pickTitle(titleMap, h.tmdb_id, recordType(h))
    if (!title) continue // not in catalog (or ambiguous legacy id) — session-end fold will retry

    const signal: DNASignal = {
      title: title.title,
      tmdb_id: h.tmdb_id,
      type: title.type,
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
      confidence: 0.75,
      flag: null,
      watched_at: null,
    }

    dna.signals.push(signal)
    signaled.add(titleKey(signal.type, signal.tmdb_id))
    applyCrewAffinityUpdate(dna.strand_a_creative_affinity, title.crew, signal.reaction)
    applyStrandCUpdate(dna.strand_c_visceral_specs, title, signal.reaction)
    merged++
  }

  if (merged > 0) await saveDNA(user_id, dna)
  return merged
}
