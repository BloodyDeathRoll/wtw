import { after } from 'next/server'
import type { DNASchema, DNASignal, SessionSummary, RecommendationResult } from '@/types/dna'
import { titleKey } from '@/lib/title-key'
import { loadDNA, saveDNA, fetchTitleCrew, bumpVersion } from './lib/load-save'
import { applyCrewAffinityUpdate } from './lib/update-crew'
import { mergeStrandB, applySignalDimensionTags } from './lib/update-strand-b'
import { applyStrandCUpdate } from './lib/update-strand-c'
import { applyStrandBFromTitle, type TitleNarrativeMetadata } from './lib/update-strand-b-from-title'
import { rewriteChangedDimensionNotes } from './lib/rewrite-dimension-notes'
import { regenerateEmbedding } from './lib/regenerate-embedding'
import { recordStretchPick } from './lib/record-stretch-pick'
import { storeSnapshot } from './lib/snapshot'
import { applyDirectives } from './lib/apply-directives'

export async function updateSchemaFromSession(
  user_id: string,
  summary: SessionSummary,
  recommendation?: RecommendationResult,
  /**
   * A DNA the caller just read/wrote (session/end holds one with the
   * watchlist marks applied). Saves the cache-first re-read. The caller is
   * responsible for it being the freshest copy.
   */
  preloaded?: DNASchema,
): Promise<DNASchema> {
  const dna = preloaded ?? await loadDNA(user_id)

  // 1. Append new signals — one signal per title, first wins, across ALL
  //    sources. The key used to include `source`, and chat sources are
  //    `session_N`: analyzeSession re-extracts titles the user mentioned in
  //    earlier turns every session, so the same film landed 7-15 times (as
  //    loved AND as disliked) and inflated strand A on every pass
  //    (measured 2026-08-28). A title the user already has an opinion on is
  //    not new evidence, whichever session mentions it again.
  const sigKey = (s: { type: DNASignal['type']; tmdb_id: string }) => titleKey(s.type, s.tmdb_id)
  const existingKeys = new Set(dna.signals.map(sigKey))
  const freshSignals: DNASignal[] = []
  for (const s of summary.new_signals) {
    const k = sigKey(s)
    if (existingKeys.has(k)) continue
    existingKeys.add(k)
    freshSignals.push(s)
  }
  dna.signals.push(...freshSignals)

  // 2. Batch-fetch title metadata for crew + visceral + narrative updates
  const tmdbIds = [...new Set(freshSignals.map(s => s.tmdb_id))]
  const titleMap = await fetchTitleCrew(tmdbIds)

  // 3. Strand A + B + C: update from each new signal — by (tmdb_id, type), so a
  //    same-id title of the other type never supplies the crew
  for (const signal of freshSignals) {
    const title = titleMap.get(titleKey(signal.type, signal.tmdb_id))
    if (!title) continue  // title not seeded yet — skip, will re-run after seed

    applyCrewAffinityUpdate(dna.strand_a_creative_affinity, title.crew, signal.reaction)
    applyStrandCUpdate(dna.strand_c_visceral_specs, title, signal.reaction)
    applyStrandBFromTitle(
      dna.strand_b_narrative_dimensions,
      title.narrative_metadata as TitleNarrativeMetadata,
      signal.reaction,
    )
  }

  // 4. Strand B: merge session brain's explicit dimension updates (highest authority)
  if (Object.keys(summary.dimension_updates).length > 0) {
    mergeStrandB(dna.strand_b_narrative_dimensions, summary.dimension_updates)
  }

  // 5. Strand B: nudge confidence from signal dimension tags
  applySignalDimensionTags(dna.strand_b_narrative_dimensions, freshSignals)

  // 6. Learning loop — open questions
  for (const q of summary.open_questions_resolved) {
    const idx = dna.learning_loop.open_questions.indexOf(q)
    if (idx >= 0) dna.learning_loop.open_questions.splice(idx, 1)
  }
  for (const q of summary.new_open_questions) {
    if (!dna.learning_loop.open_questions.includes(q)) {
      dna.learning_loop.open_questions.push(q)
    }
  }

  // 6b. Contextual logic — standing instructions the user gave in chat.
  //     Merged before the version bump below, so the rec cache (keyed by
  //     taste_version) is busted by the same write that adds the rule and the
  //     very next batch is generated under it.
  const merged = applyDirectives(dna.contextual_logic, summary.directives)
  if (merged.exclusions_added > 0 || merged.soft_preferences_added > 0) {
    console.log(
      `[update-from-session] +${merged.exclusions_added} exclusion(s), ` +
      `+${merged.soft_preferences_added} soft preference(s)`,
    )
  }

  // 7. Mark recommendation outcome if provided
  if (summary.recommendation_made && summary.recommendation_accepted !== null) {
    const rec = dna.learning_loop.recommendation_history.findLast(
      r => r.tmdb_id === summary.recommendation_made,
    )
    if (rec) rec.accepted = summary.recommendation_accepted
  }

  // 7b. Record a stretch pick history entry the first time it's presented
  if (summary.recommendation_made && recommendation?.is_stretch_pick) {
    dna.learning_loop = recordStretchPick(dna.learning_loop, recommendation, summary.session_number)
  }

  // 8. Increment session count + bump version
  dna.metadata.total_sessions = summary.session_number
  bumpVersion(dna)

  // 9. Rewrite any dimension notes that changed significantly (fire-and-forget on error)
  await rewriteChangedDimensionNotes(dna, freshSignals).catch(err =>
    console.warn('[update-from-session] notes rewrite failed:', err)
  )

  // 10. Regenerate Mistral embedding snapshot (fire-and-forget on error)
  //     The engine's Redis cache handles the embedding for scoring —
  //     this persists the historical snapshot in fingerprint_embeddings.
  //     Skips the Mistral call when the strand text is unchanged (hash).
  await regenerateEmbedding(user_id, dna).catch(err =>
    console.warn('[update-from-session] embedding regen failed:', err)
  )

  await saveDNA(user_id, dna)

  // 11. Store a versioned snapshot (keep-last-5, pruned in storeSnapshot).
  //     Archival only — 2-3 DB round trips nobody is waiting on, so after the
  //     response when there is one (guarded: `after` throws outside a request).
  const snapshot = () =>
    storeSnapshot(user_id, dna).catch(err =>
      console.warn('[update-from-session] snapshot store failed:', err)
    )
  try {
    after(snapshot)
  } catch {
    await snapshot()
  }

  return dna
}
