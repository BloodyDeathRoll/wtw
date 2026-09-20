/**
 * Strand C content affinity — genre, original language, movie vs series.
 *
 * Why (2026-09-06): the fingerprint had no dimension for what KIND of thing a
 * title is. A user with 27 disliked anime had 27 dead signals — each one
 * excluded exactly its own title from the next batch and generalised to
 * nothing, so the next batch was more anime. Crew affinity generalises across
 * a person's filmography; this is the same idea one level up.
 *
 * The arithmetic is deliberately the same as update-crew.ts, because it is the
 * same question asked of a different attribute, and because the engine already
 * knows how to read a running average reaction level.
 *
 * Genres are only as good as the catalog's tagging, so this is a nudge, not a
 * rule: a user who says "no horror" gets an exclusion rule, which is absolute.
 * This is what catches the taste they never put into words.
 */

import type { StrandC, ContentAffinityEntry, Reaction } from '@/types/dna'
import { REACTION_SCORE, confidenceDelta, clamp } from './reaction-score'

export type ContentAffinityBucket = 'genre_affinity' | 'language_affinity' | 'format_affinity'

export interface ContentAttributes {
  type: 'movie' | 'tv'
  genres?: { name: string }[] | null
  original_language?: string | null
}

/** Starting confidence for a first sighting — matches strand_a. */
const FIRST_CONFIDENCE = 0.15

export function applyContentAffinityUpdate(
  strand_c: StrandC,
  title: ContentAttributes,
  reaction: Reaction,
  /** Small nudges (regret / glad-watched) pass their own delta. */
  scoreDeltaOverride?: number,
): void {
  const delta = scoreDeltaOverride ?? REACTION_SCORE[reaction]

  const genres = (title.genres ?? [])
    .map(g => g?.name?.trim().toLowerCase())
    .filter((n): n is string => !!n)
  bump(strand_c, 'genre_affinity', genres, delta, scoreDeltaOverride != null)

  const language = title.original_language?.trim().toLowerCase()
  bump(strand_c, 'language_affinity', language ? [language] : [], delta, scoreDeltaOverride != null)

  bump(strand_c, 'format_affinity', [title.type], delta, scoreDeltaOverride != null)
}

function bump(
  strand_c: StrandC,
  bucket: ContentAffinityBucket,
  keys: string[],
  delta: number,
  isNudge: boolean,
): void {
  if (keys.length === 0) return
  // Created on first use — a fingerprint written before 2026-09-20 has none.
  const map = (strand_c[bucket] ??= {})

  for (const key of new Set(keys)) {
    const existing = map[key]
    if (!existing) {
      map[key] = { score: clamp(delta, -1, 1), confidence: FIRST_CONFIDENCE, sample_size: 1 }
      continue
    }
    const newScore = clamp(
      (existing.score * existing.sample_size + delta) / (existing.sample_size + 1),
      -1,
      1,
    )
    const confDelta = isNudge
      ? (delta > 0 ? +0.03 : -0.03)
      : confidenceDelta(existing.score, delta)

    existing.score = newScore
    existing.confidence = clamp(existing.confidence + confDelta, 0, 1)
    existing.sample_size += 1
  }
}

/**
 * Below this many ratings an entry is noise — one disliked comedy is a bad
 * night, not a taste. Lives here, with the shape it describes, so the writer
 * and the engine's scorer cannot drift apart on what counts as evidence.
 */
export const MIN_CONTENT_SAMPLES = 3

/** Entries with enough evidence to say something, strongest feeling first. */
export function strongestContentAffinities(
  map: Record<string, ContentAffinityEntry> | undefined,
  minSamples = MIN_CONTENT_SAMPLES,
): [string, ContentAffinityEntry][] {
  return Object.entries(map ?? {})
    .filter(([, e]) => e.sample_size >= minSamples)
    .sort((a, b) => Math.abs(b[1].score) - Math.abs(a[1].score))
}
