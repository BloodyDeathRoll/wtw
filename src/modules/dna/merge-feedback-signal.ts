/**
 * mergeFeedbackSignalsLight — incremental per-click fingerprint update.
 *
 * Called by POST /api/recommendations/feedback right after a 👍/👎 lands in
 * recommendation_history. Converts any rated-but-unsignaled history entries
 * into DNASignals and applies the CHEAP updates only:
 *   - append signal (dedup vs existing signals)
 *   - Strand A crew affinity + Strand C visceral weights (pure arithmetic)
 *   - re-rates: a title already signaled whose latest rating differs gets
 *     its old reaction's contribution swapped for the new one (applyReRates)
 *
 * Deliberately NO taste_version bump, NO embedding regen, NO notes rewrite,
 * NO snapshot: bumping per click would invalidate the rec cache the user is
 * actively scrolling (GET falls back to mocks on a version miss), and the
 * LLM/embedding work belongs to session-end. When "Find more" / session-end
 * runs, updateSchemaFromSession bumps once, regenerates the embedding over
 * the accumulated strand changes, and its fold skips everything already
 * signaled here (dedup key: type:tmdb_id, one signal per title across all
 * sources — first wins).
 *
 * Concurrency: a read-modify-write on the DNA JSONB, saved with a
 * compare-and-set and retried once on a miss (2026-09-20). The rec UI queues
 * feedback clicks, which used to be enough — until the batch refresh started
 * writing the same column from `after()`, concurrently with the next click. A
 * blind save from here would silently revert its version bump.
 */

import type { DNASchema, DNASignal, Reaction } from '@/types/dna'
import { recordKey, recordType, titleKey } from '@/lib/title-key'
import { withDNAUpdate, fetchTitleCrew, pickTitle } from './lib/load-save'
import { applyCrewAffinityUpdate, replaceCrewAffinity } from './lib/update-crew'
import { applyStrandCUpdate } from './lib/update-strand-c'
import { applyContentAffinityUpdate, replaceContentAffinity } from './lib/update-content-affinity'
import { REACTION_SCORE } from './lib/reaction-score'
import { applyStrandBFromTitle, type TitleNarrativeMetadata } from './lib/update-strand-b-from-title'

export async function mergeFeedbackSignalsLight(user_id: string): Promise<number> {
  // Reset on every attempt: a compare-and-set miss means the merge is redone
  // against fresh state, and the count has to describe the attempt that
  // actually saved.
  let merged = 0

  const outcome = await withDNAUpdate(user_id, async dna => {
    merged = await mergeInto(dna)
    return merged > 0
  })
  if (outcome === 'conflict') {
    console.warn('[feedback-merge] conflicted twice; session-end fold will catch it')
    return 0
  }
  return outcome === 'saved' ? merged : 0
}

/**
 * Fold every rated-but-unsignaled history entry into the fingerprint.
 * Re-runnable, so `withDNAUpdate` can replay it against a newer row when its
 * compare-and-set misses — a replay re-reads the catalog, which is the price
 * of never saving a snapshot that went stale.
 */
async function mergeInto(dna: DNASchema): Promise<number> {
  const reRated = await applyReRates(dna)

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
  if (pending.length === 0) return reRated

  const titleMap = await fetchTitleCrew(pending.map((h) => h.tmdb_id))

  let merged = reRated
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
      // The rating time is the clock temporal decay ages (CLAUDE.md:
      // ratings older than 18 months weigh 50%). null skipped decay forever.
      watched_at: new Date().toISOString(),
    }

    dna.signals.push(signal)
    signaled.add(titleKey(signal.type, signal.tmdb_id))
    applyCrewAffinityUpdate(dna.strand_a_creative_affinity, title.crew, signal.reaction)
    applyStrandCUpdate(dna.strand_c_visceral_specs, title, signal.reaction)
    applyContentAffinityUpdate(dna.strand_c_visceral_specs, title, signal.reaction)
    applyStrandBFromTitle(
      dna.strand_b_narrative_dimensions,
      title.narrative_metadata as TitleNarrativeMetadata,
      signal.reaction,
    )
    merged++
  }

  return merged
}

/**
 * Re-rates. "One signal per title, first wins" keeps chat re-extraction from
 * stacking duplicates, but it also froze the user's own correction: re-rating
 * on "Your ratings" (loved → disliked) rewrote the history row while the
 * signal, the crew/content averages and strand C kept the first verdict.
 *
 * The user's latest card rating is what the fingerprint must hold, so for each
 * signal whose title's latest rating differs, the old reaction's contribution
 * is swapped for the new one: exact for the crew and content running averages,
 * the delta difference for strand C. Strand B's categorical rule can't be
 * undone, so it takes the new reaction as one more observation — which moves
 * it the new way.
 *
 * Shared with the session-end write (updateSchemaFromSession) so a re-rate the
 * light merge couldn't save still lands. Typed history rows only: a legacy
 * bare row can't say which title it meant. Returns how many were re-rated.
 */
export async function applyReRates(dna: DNASchema): Promise<number> {
  const latest = new Map<string, Reaction>()
  for (const h of dna.learning_loop.recommendation_history) {
    if (h.rating == null || !recordType(h)) continue
    latest.set(recordKey(h), h.rating)
  }
  const changed = dna.signals.filter((s) => {
    const next = latest.get(titleKey(s.type, s.tmdb_id))
    return next != null && next !== s.reaction && REACTION_SCORE[next] != null
  })
  if (changed.length === 0) return 0

  const titleMap = await fetchTitleCrew(changed.map((s) => s.tmdb_id))

  let reRated = 0
  for (const signal of changed) {
    const title = pickTitle(titleMap, signal.tmdb_id, signal.type)
    if (!title) continue // not in catalog — retried on the next merge

    const next = latest.get(titleKey(signal.type, signal.tmdb_id))!
    // A legacy reaction ('mixed', dropped in migration 0013) has no delta to
    // take back out — score the new one as a first rating instead.
    const previous = REACTION_SCORE[signal.reaction] != null ? signal.reaction : null
    if (previous) {
      replaceCrewAffinity(dna.strand_a_creative_affinity, title.crew, previous, next)
      replaceContentAffinity(dna.strand_c_visceral_specs, title, previous, next)
    } else {
      applyCrewAffinityUpdate(dna.strand_a_creative_affinity, title.crew, next)
      applyContentAffinityUpdate(dna.strand_c_visceral_specs, title, next)
    }
    applyStrandCUpdate(dna.strand_c_visceral_specs, title, next, previous ?? undefined)
    applyStrandBFromTitle(
      dna.strand_b_narrative_dimensions,
      title.narrative_metadata as TitleNarrativeMetadata,
      next,
    )

    signal.reaction = next
    signal.reason = next === 'disliked'
      ? 'Rejected from a recommendation card'
      : 'Rated on a recommendation card'
    // The re-rate is the newest opinion — temporal decay ages it from now.
    signal.watched_at = new Date().toISOString()
    reRated++
  }
  return reRated
}
