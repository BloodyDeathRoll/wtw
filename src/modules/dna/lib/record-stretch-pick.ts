import type { LearningLoop, RecommendationResult } from '@/types/dna'

/**
 * Appends a stretch pick record to the learning loop when a stretch pick
 * recommendation is made. The accept/reject outcome is patched later by
 * POST /api/recommendations/feedback.
 *
 * Pure function — does not mutate input.
 */
export function recordStretchPick(
  current: LearningLoop,
  result: RecommendationResult,
  sessionNumber: number,
): LearningLoop {
  if (!result.is_stretch_pick) return current

  return {
    ...current,
    stretch_pick_history: [
      ...current.stretch_pick_history,
      {
        title:               result.title,
        tmdb_id:             result.tmdb_id,
        accepted:            false,
        reaction:            null,
        session:             sessionNumber,
        dimensions_stretched: result.reason_payload.stretch_rationale
          ? [result.reason_payload.stretch_rationale]
          : [],
      },
    ],
  }
}
