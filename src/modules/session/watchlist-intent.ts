/**
 * markSavedInHistory / unmarkSavedInHistory
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
 * Deliberately NOT written into dna.signals: mergeFeedbackSignalsLight and
 * foldRatedHistoryIntoSummary dedup ratings against signals across ALL sources,
 * so a watchlist signal landing first would silently swallow the user's later
 * loved/liked/disliked for that title.
 *
 * The marker IS an exclusion: step1 candidate-gen and the GET route drop saved
 * titles from the feed (decided 2026-08-28 — a saved title showing up again as
 * a "new" recommendation reads as a repeat). Unsaving clears it via
 * unmarkSavedInHistory so the title can come back.
 *
 * When the user later rates the title, the feedback route's `watched` branch
 * supersedes this marker on its own. No cleanup needed here.
 *
 * Keys: `recommended` carries the composite "type:tmdb_id" (src/lib/title-key.ts);
 * `tmdb_id` stays bare. Mock ids (bare slugs) are stored as-is in both.
 */

import type { RecommendationRecord } from '@/types/dna'
import { parseTitleKey, recordMatches, isSavedMarker } from '@/lib/title-key'

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
    const { type, tmdb_id } = parseTitleKey(id)
    if (!tmdb_id) continue

    // findLast: the newest entry for the title is the one that reflects its
    // current state, matching how the feedback route resolves history.
    const at = next.findLastIndex((h) => recordMatches(h, tmdb_id, type))

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
      recommended: id,
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

/**
 * The inverse: the user took a title off the watchlist. Clears the saved marker
 * (accepted → false) on unrated, unwatched entries only — a rating or a watch
 * is a stronger signal and stays. Same reference back when nothing changed.
 */
export function unmarkSavedInHistory(
  history: RecommendationRecord[],
  ids: string[],
): RecommendationRecord[] {
  if (ids.length === 0) return history

  const next = [...history]
  let changed = false

  for (const id of ids) {
    const { type, tmdb_id } = parseTitleKey(id)
    if (!tmdb_id) continue
    const at = next.findLastIndex((h) => recordMatches(h, tmdb_id, type))
    if (at < 0) continue
    const entry = next[at]
    if (entry.watched || entry.rating != null || !entry.accepted) continue
    next[at] = { ...entry, accepted: false }
    changed = true
  }

  return changed ? next : history
}

// The marker predicate lives in the shared lib (the engine's step1 reads it too).
export { isSavedMarker }
