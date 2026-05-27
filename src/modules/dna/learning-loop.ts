import type {
  LearningLoop,
  SessionSummary,
  RecommendationResult,
  RecommendationRecord,
  StretchPickRecord,
  Reaction,
} from '@/types/dna'
import { createClient } from '@/lib/supabase/server'

/**
 * Updates the LearningLoop section from a completed session.
 *
 * - Resolves open questions listed in the summary
 * - Appends new open questions (append-only per schema contract)
 * - Records the recommendation outcome (if one was made this session)
 *
 * Pure function — returns updated LearningLoop, does not mutate input.
 */
export function updateLearningLoop(
  current: LearningLoop,
  summary: SessionSummary,
): LearningLoop {
  // Resolve answered questions, then append new ones
  const resolvedSet = new Set(summary.open_questions_resolved)
  const remainingQuestions = current.open_questions.filter(
    (q) => !resolvedSet.has(q),
  )
  const openQuestions = [...remainingQuestions, ...summary.new_open_questions]

  // Record the recommendation outcome if one was made
  let recommendationHistory = [...current.recommendation_history]
  if (summary.recommendation_made) {
    const record: RecommendationRecord = {
      session:             summary.session_number,
      recommended:         summary.recommendation_made,
      tmdb_id:             '',   // writer will patch this from RecommendationResult if available
      accepted:            summary.recommendation_accepted ?? false,
      watched:             false, // updated later via recordRecommendationFeedback
      rating:              null,
      fingerprint_version: 0,    // writer patches this from current taste_version
    }
    recommendationHistory = [...recommendationHistory, record]
  }

  return {
    ...current,
    open_questions:         openQuestions,
    recommendation_history: recommendationHistory,
  }
}

/**
 * Patches a recommendation record when the user later reports they watched it
 * and optionally rates it. Also handles stretch pick outcomes.
 *
 * Writes directly to Supabase — this is called asynchronously, not during writeDNA.
 */
export async function recordRecommendationFeedback(
  userId: string,
  tmdbId: string,
  watched: boolean,
  rating: Reaction | null,
): Promise<void> {
  const supabase = await createClient()

  // Fetch current DNA
  const { data, error } = await supabase
    .from('users')
    .select('dna')
    .eq('id', userId)
    .single()

  if (error || !data?.dna) {
    console.error('[learning-loop] Failed to fetch DNA for feedback patch:', error)
    return
  }

  const dna = data.dna as { learning_loop: LearningLoop }
  const loop = dna.learning_loop

  // Patch the matching recommendation record
  const updatedHistory = loop.recommendation_history.map((r) =>
    r.tmdb_id === tmdbId
      ? { ...r, watched, rating: rating ?? r.rating }
      : r,
  )

  // Patch stretch pick record if applicable
  const updatedStretch = loop.stretch_pick_history.map((s) =>
    s.tmdb_id === tmdbId
      ? { ...s, accepted: watched, reaction: rating ?? s.reaction }
      : s,
  )

  const { error: updateError } = await supabase
    .from('users')
    .update({
      dna: {
        ...dna,
        learning_loop: {
          ...loop,
          recommendation_history: updatedHistory,
          stretch_pick_history:   updatedStretch,
        },
      },
    })
    .eq('id', userId)

  if (updateError) {
    console.error('[learning-loop] Failed to write feedback patch:', updateError)
  }
}

/**
 * Appends a stretch pick record to the learning loop.
 * Called by the writer when a stretch pick recommendation is made.
 *
 * Pure function.
 */
export function recordStretchPick(
  current: LearningLoop,
  result: RecommendationResult,
  sessionNumber: number,
): LearningLoop {
  if (!result.is_stretch_pick) return current

  const record: StretchPickRecord = {
    title:               result.title,
    tmdb_id:             result.tmdb_id,
    accepted:            false,   // updated later via recordRecommendationFeedback
    reaction:            null,
    session:             sessionNumber,
    dimensions_stretched: result.reason_payload.stretch_rationale
      ? [result.reason_payload.stretch_rationale]
      : [],
  }

  return {
    ...current,
    stretch_pick_history: [...current.stretch_pick_history, record],
  }
}
