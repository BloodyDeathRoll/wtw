import type { Reaction } from '@/types/dna'
import type { MediaType } from '@/lib/title-key'
import { loadDNA, saveDNA, bumpVersion } from './lib/load-save'
import { clamp } from './lib/reaction-score'

export async function updateSchemaFromStretch(
  user_id: string,
  tmdb_id: string,
  reaction: Reaction,
  // Kept for the caller's contract; the crew half no longer needs it.
  _type?: MediaType | null,
): Promise<void> {
  const dna = await loadDNA(user_id)

  // 1. If loved/liked → the "stretched" dimensions may be an emerging preference.
  //    Boost their confidence so the engine explores that direction more.
  const record = dna.learning_loop.stretch_pick_history.find(s => s.tmdb_id === tmdb_id)
  if (!record || (reaction !== 'loved' && reaction !== 'liked')) return

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

  // 2. No crew update here: the feedback route's mergeFeedbackSignalsLight has
  //    already folded this rating into strand A as a normal signal (and the
  //    session-end fold dedups against it). Applying it again counted every
  //    rated stretch pick's crew twice.

  bumpVersion(dna)
  await saveDNA(user_id, dna)
}
