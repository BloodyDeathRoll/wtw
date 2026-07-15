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
 * NOTE: this is necessary but NOT sufficient to decide the fast path. Card
 * ratings are pre-merged into dna.signals at click time, so the session-end
 * fold dedups them to zero and they don't appear in `new_signals` — meaning a
 * "Find more" after rating returns false here even though the served rec cache
 * still contains the rated titles. session/end therefore pairs this with a
 * stale-cache check (does the cache still hold a rated title?) before skipping
 * regeneration. `recommendation_made` is included defensively: analyzeSession
 * leaves it null today, but if it's ever populated, skipping the update here
 * would otherwise silently drop the acceptance/stretch-pick history it feeds.
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
