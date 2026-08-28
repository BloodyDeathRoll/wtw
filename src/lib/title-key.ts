/**
 * title-key — the ONE way to address a title across modules.
 *
 * TMDB movie and TV ids are separate namespaces that collide (id 105 is both
 * Back to the Future and Sex and the City; 617 such pairs in the catalog).
 * Anything keyed on a bare tmdb_id can therefore point at the wrong title —
 * which is how rated movies kept coming back as recommendations: the rating
 * was signaled against the same-id TV show, and the `${type}:${tmdb_id}`
 * exclusion never matched.
 *
 * Rules:
 *   - Persist and compare titles by `titleKey(type, tmdb_id)`.
 *   - `RecommendationRecord.recommended` carries that composite key. `tmdb_id`
 *     stays bare for readers that predate this. Legacy rows (written before
 *     2026-08-28) have `recommended === tmdb_id` (bare) and no type — treat
 *     them as "type unknown", never guess.
 */

import type { RecommendationRecord } from '@/types/dna'

export type MediaType = 'movie' | 'tv'

export function isMediaType(v: unknown): v is MediaType {
  return v === 'movie' || v === 'tv'
}

export function titleKey(type: MediaType, tmdb_id: string): string {
  return `${type}:${tmdb_id}`
}

/** "movie:105" → { type: 'movie', tmdb_id: '105' }; anything else → type null. */
export function parseTitleKey(key: string): { type: MediaType | null; tmdb_id: string } {
  const m = /^(movie|tv):(.+)$/.exec(key)
  if (m) return { type: m[1] as MediaType, tmdb_id: m[2] }
  return { type: null, tmdb_id: key }
}

/** The media type a history entry was written with, or null for a legacy row. */
export function recordType(h: RecommendationRecord): MediaType | null {
  return parseTitleKey(h.recommended ?? '').type
}

/**
 * The exclusion key for a history entry: the composite key when the row
 * carries a type, the bare tmdb_id when it doesn't. Bare ids never contain ':'
 * so both can live in one Set — see `matchesKeySet`.
 */
export function recordKey(h: RecommendationRecord): string {
  const type = recordType(h)
  return type ? titleKey(type, h.tmdb_id) : h.tmdb_id
}

/**
 * Does the entry refer to this title? Exact on a typed row; bare-id on a legacy
 * row (its type is unknown, and matching bare is the fail-safe direction for a
 * rating: it over-excludes rather than re-serving a judged title).
 */
export function recordMatches(h: RecommendationRecord, tmdb_id: string, type: MediaType | null | undefined): boolean {
  if (h.tmdb_id !== tmdb_id) return false
  const t = recordType(h)
  return !t || !type || t === type
}

/**
 * A live watchlist marker in recommendation_history: saved, not watched, not
 * rated. Written by markSavedInHistory (src/modules/session/watchlist-intent.ts);
 * nothing else produces this combination. Lives here because both the engine
 * (step1 exclusion) and the session module read it.
 */
export function isSavedMarker(h: RecommendationRecord): boolean {
  return h.accepted === true && h.watched === false && h.rating == null
}

/**
 * Membership test against a Set built from `recordKey`/`titleKey` values:
 * true when the composite key OR the bare id is present (legacy rows).
 */
export function matchesKeySet(keys: ReadonlySet<string>, type: MediaType, tmdb_id: string): boolean {
  return keys.has(titleKey(type, tmdb_id)) || keys.has(tmdb_id)
}

/**
 * Expand a key set into the `${type}:${tmdb_id}` list the candidate RPC takes.
 * A bare (legacy) id fans out to both types — over-exclusion of an unrelated
 * same-id title is the cost of not knowing, and it's rare (legacy rows only).
 */
export function toRpcKeys(keys: ReadonlySet<string>): string[] {
  const out: string[] = []
  for (const k of keys) {
    if (parseTitleKey(k).type) out.push(k)
    else out.push(titleKey('movie', k), titleKey('tv', k))
  }
  return out
}
