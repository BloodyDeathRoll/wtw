import type { DNASchema, SessionSummary } from '@/types/dna'
import { loadDNA, saveDNA, fetchTitleCrew, bumpVersion } from './lib/load-save'
import { applyCrewAffinityUpdate } from './lib/update-crew'
import { mergeStrandB, applySignalDimensionTags } from './lib/update-strand-b'
import { applyStrandCUpdate } from './lib/update-strand-c'
import { rewriteChangedDimensionNotes } from './lib/rewrite-dimension-notes'
import { regenerateEmbedding } from './lib/regenerate-embedding'

export async function updateSchemaFromSession(
  user_id: string,
  summary: SessionSummary,
): Promise<DNASchema> {
  const dna = await loadDNA(user_id)

  // 1. Append new signals — deduplicate by tmdb_id + source
  const existingKeys = new Set(dna.signals.map(s => `${s.tmdb_id}:${s.source}`))
  const freshSignals = summary.new_signals.filter(
    s => !existingKeys.has(`${s.tmdb_id}:${s.source}`),
  )
  dna.signals.push(...freshSignals)

  // 2. Batch-fetch title metadata for crew + visceral updates
  const tmdbIds = [...new Set(freshSignals.map(s => s.tmdb_id))]
  const titleMap = await fetchTitleCrew(tmdbIds)

  // 3. Strand A + C: update from each new signal
  for (const signal of freshSignals) {
    const title = titleMap.get(signal.tmdb_id)
    if (!title) continue  // title not seeded yet — skip, will re-run after seed

    applyCrewAffinityUpdate(dna.strand_a_creative_affinity, title.crew, signal.reaction)
    applyStrandCUpdate(dna.strand_c_visceral_specs, title, signal.reaction)
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

  // 7. Mark recommendation outcome if provided
  if (summary.recommendation_made && summary.recommendation_accepted !== null) {
    const rec = dna.learning_loop.recommendation_history.findLast(
      r => r.tmdb_id === summary.recommendation_made,
    )
    if (rec) rec.accepted = summary.recommendation_accepted
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
  await regenerateEmbedding(user_id, dna).catch(err =>
    console.warn('[update-from-session] embedding regen failed:', err)
  )

  await saveDNA(user_id, dna)

  return dna
}
