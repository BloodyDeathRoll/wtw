import type { Reaction } from '@/types/dna'
import { loadDNA, saveDNA, fetchTitleCrew, bumpVersion } from './lib/load-save'
import { applyCrewAffinityUpdate } from './lib/update-crew'
import { clamp } from './lib/reaction-score'

export async function updateSchemaFromStretch(
  user_id: string,
  tmdb_id: string,
  reaction: Reaction,
): Promise<void> {
  const dna = await loadDNA(user_id)

  // 1. If loved/liked → the "stretched" dimensions may be an emerging preference.
  //    Boost their confidence so the engine explores that direction more.
  const record = dna.learning_loop.stretch_pick_history.find(s => s.tmdb_id === tmdb_id)
  if (record && (reaction === 'loved' || reaction === 'liked')) {
    const boost = reaction === 'loved' ? 0.08 : 0.04
    for (const dim of record.dimensions_stretched) {
      const key = dim as keyof typeof dna.strand_b_narrative_dimensions
      if (key in dna.strand_b_narrative_dimensions) {
        dna.strand_b_narrative_dimensions[key].confidence = clamp(
          dna.strand_b_narrative_dimensions[key].confidence + boost,
          0, 1,
        )
      }
    }
  }

  // 2. Apply crew affinity update (same weight as a normal watched signal)
  const titleMap = await fetchTitleCrew([tmdb_id])
  const title = titleMap.get(tmdb_id)
  if (title) {
    applyCrewAffinityUpdate(dna.strand_a_creative_affinity, title.crew, reaction)
  }

  bumpVersion(dna)
  await saveDNA(user_id, dna)
}
