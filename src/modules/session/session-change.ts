import type { SessionSummary } from '@/types/dna'

/**
 * Does this session summary carry anything worth merging into the fingerprint?
 *
 * Drives the /api/session/end no-op fast path: when this is false (e.g. a
 * "Find more" with nothing rated and nothing said), the route skips the DNA
 * update — which unconditionally bumps taste_version and busts the rec +
 * embedding caches — and the cold recommendation pipeline, returning the warm
 * cache instantly instead.
 *
 * Card ratings are folded into `new_signals` (see foldRatedHistoryIntoSummary)
 * BEFORE this check, so a "Find more" after rating correctly takes the slow
 * path. `recommendation_made` is included defensively: analyzeSession leaves it
 * null today, but if it's ever populated, skipping the update here would
 * otherwise silently drop the acceptance/stretch-pick history it feeds.
 */
export function hasMaterialChange(summary: SessionSummary): boolean {
  return (
    summary.new_signals.length > 0 ||
    Object.keys(summary.dimension_updates).length > 0 ||
    summary.open_questions_resolved.length > 0 ||
    summary.new_open_questions.length > 0 ||
    summary.recommendation_made != null
  )
}
