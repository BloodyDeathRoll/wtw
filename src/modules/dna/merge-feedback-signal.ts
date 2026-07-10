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
 * signaled here (dedup key: tmdb_id + source).
 *
 * Concurrency: callers must serialize invocations per user (the rec UI queues
 * feedback clicks) — this is a read-modify-write on the DNA JSONB.
 */

import type { DNASchema, DNASignal } from '@/types/dna'
import { loadDNA, saveDNA, fetchTitleCrew } from './lib/load-save'
import { applyCrewAffinityUpdate } from './lib/update-crew'
import { applyStrandCUpdate } from './lib/update-strand-c'

export async function mergeFeedbackSignalsLight(user_id: string): Promise<number> {
  const dna: DNASchema = await loadDNA(user_id)

  const signaled = new Set(dna.signals.map((s) => s.tmdb_id))
  const pending = dna.learning_loop.recommendation_history.filter(
    (h) => h.rating != null && !signaled.has(h.tmdb_id),
  )
  if (pending.length === 0) return 0

  const titleMap = await fetchTitleCrew(pending.map((h) => h.tmdb_id))

  let merged = 0
  for (const h of pending) {
    const title = titleMap.get(h.tmdb_id)
    if (!title) continue // not in catalog yet — session-end fold will retry

    const signal: DNASignal = {
      title: (title as unknown as { title?: string }).title ?? h.tmdb_id,
      tmdb_id: h.tmdb_id,
      type: (title as unknown as { type?: 'movie' | 'tv' }).type ?? 'movie',
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
    applyCrewAffinityUpdate(dna.strand_a_creative_affinity, title.crew, signal.reaction)
    applyStrandCUpdate(dna.strand_c_visceral_specs, title, signal.reaction)
    merged++
  }

  if (merged > 0) await saveDNA(user_id, dna)
  return merged
}
