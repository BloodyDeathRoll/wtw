/**
 * markSavedInHistory
 *
 * Records "the user saved this to their watchlist" in the fingerprint. Saving is
 * an INTEREST signal — weaker than a rating, and not a watch. It is encoded in
 * learning_loop.recommendation_history as:
 *
 *     accepted: true, watched: false, rating: null
 *
 * Nothing else produces that combination (POST /api/recommendations/feedback
 * moves `accepted` and `watched` together), so it is an unambiguous marker, and
 * it needs no change to the shared contract in src/types/dna.ts.
 *
 * Deliberately NOT written into dna.signals, for two independent reasons:
 *
 *   1. mergeFeedbackSignalsLight and foldRatedHistoryIntoSummary both dedup on
 *      bare tmdb_id ACROSS ALL SOURCES. A watchlist signal landing first would
 *      silently swallow the user's later loved/liked/disliked for that title.
 *   2. step1-candidate-gen builds watched_keys from dna.signals, so the title
 *      would vanish from every future batch — but a saved title is meant to stay
 *      in the feed showing "Remove from watchlist".
 *
 * When the user later rates the title, the feedback route's `watched` branch
 * supersedes this marker on its own. No cleanup needed here.
 */

import type { RecommendationRecord } from '@/types/dna'

/** Watchlist ids are "type:tmdb_id" (engine recs) or a bare slug (mocks). */
function tmdbIdOf(id: string): string {
  const cut = id.lastIndexOf(':')
  return cut === -1 ? id : id.slice(cut + 1)
}

export interface SavedMarkContext {
  /** dna.metadata.total_sessions — stamped on entries we have to create. */
  session: number
  /** dna.metadata.taste_version — ditto. */
  fingerprintVersion: number
}

/**
 * Returns a new history array with each id marked as saved. Ids already rated or
 * watched are left untouched — a rating outranks an intent, and re-saving must
 * never walk a stronger signal backwards. Ids with no history entry get one
 * (recommendations served straight from the Redis cache never appended theirs).
 */
export function markSavedInHistory(
  history: RecommendationRecord[],
  ids: string[],
  ctx: SavedMarkContext,
): RecommendationRecord[] {
  if (ids.length === 0) return history

  const next = [...history]
  // Returning a fresh array unconditionally would defeat the caller's
  // `updated !== history` skip-check, so a retried request would rewrite an
  // identical DNA row, bust the cache, and report saves it didn't record.
  let changed = false

  for (const id of ids) {
    const tmdb_id = tmdbIdOf(id)
    if (!tmdb_id) continue

    // findLast: the newest entry for the title is the one that reflects its
    // current state, matching how the feedback route resolves history.
    const at = next.findLastIndex((h) => h.tmdb_id === tmdb_id)

    if (at >= 0) {
      const entry = next[at]
      // Already watched or already rated → a stronger signal exists. Leave it.
      if (entry.watched || entry.rating != null) continue
      if (entry.accepted) continue // already marked saved
      next[at] = { ...entry, accepted: true }
      changed = true
      continue
    }

    changed = true
    next.push({
      session: ctx.session,
      recommended: tmdb_id,
      tmdb_id,
      accepted: true,
      watched: false,
      rating: null,
      fingerprint_version: ctx.fingerprintVersion,
    })
  }

  // Same reference when nothing moved, so the caller can skip the write.
  return changed ? next : history
}
