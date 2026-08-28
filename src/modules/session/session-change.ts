import type {
  SessionSummary,
  RecommendationRecord,
  RecommendationResult,
} from '@/types/dna'
import { matchesKeySet, recordKey } from '@/lib/title-key'

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

/**
 * The set of titles the user has rated (👍/👎), read from
 * recommendation_history. These are the titles that must not survive in the
 * served rec cache after a "Find more".
 *
 * Keys are `type:tmdb_id` for rows that carry a type, the bare tmdb_id for
 * legacy rows (see src/lib/title-key.ts) — test with `matchesKeySet`.
 */
export function ratedTmdbIds(history: RecommendationRecord[]): Set<string> {
  return new Set(history.filter((h) => h.rating != null).map(recordKey))
}

/**
 * The second half of the session/end fast-path decision (split out from the
 * route so it's unit-testable without Redis/Supabase): can the currently-warm
 * rec cache still be served AS-IS, or must it be regenerated?
 *
 * Returns true — safe to keep serving, take the no-op fast path — ONLY when the
 * cache both exists (non-empty) AND holds no title the user has since rated:
 *   - a cold/empty cache → false, so the route regenerates rather than letting
 *     GET fall back to mocks for a fingerprinted user;
 *   - a cache still holding a rated title → false, so the route regenerates and
 *     candidate-gen drops that title from the next batch.
 *
 * Typed rows match exactly; legacy bare-id rows match on the id alone, which is
 * the fail-safe direction — a cross-type collision only forces an unnecessary
 * regen, never a missed one.
 */
export function cacheServableUnchanged(
  ratedIds: Set<string>,
  cached: RecommendationResult[] | null | undefined,
): boolean {
  if (!cached || cached.length === 0) return false
  return !cached.some((r) => matchesKeySet(ratedIds, r.type, r.tmdb_id))
}
