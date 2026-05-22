/**
 * Step 2 — Composite Scoring
 *
 * For each candidate, computes all score components and the weighted composite.
 * Returns candidates sorted by composite_score descending.
 *
 * composite_score =
 *   (crew_affinity_score   × 0.35) +   // strand_a + lineage boost
 *   (narrative_match_score × 0.30) +   // strand_b pgvector cosine sim
 *   (visceral_match_score  × 0.20) +   // strand_c pacing/tone
 *   (external_rating_score × 0.10) +   // TMDB + OMDB normalized
 *   (recency_boost         × 0.05)     // slight recency bump
 *
 * DB queries: 1 pgvector RPC + up to 2 lineage fetches (only when
 * strand_a has crew with lineage_boost set — rare for new users).
 */

import { computeCrewAffinity } from '../scoring/crew-affinity'
import { computeNarrativeMatchScores } from '../scoring/narrative-match'
import { computeVisceralMatch } from '../scoring/visceral-match'
import {
  getBoostEligibleIds,
  fetchLineageCache,
  computeBoostFromCaches,
  type LineageCache,
} from '../scoring/lineage-boost'
import type { DNASchema } from '@/types/dna'
import type { TitleRow, ScoredTitle } from '../types'

const CURRENT_YEAR = new Date().getFullYear()

function externalRatingScore(title: TitleRow): number {
  const tmdb = title.tmdb_rating != null ? (title.tmdb_rating / 10) * 0.6 : null
  const omdb = title.omdb_rating != null ? title.omdb_rating * 0.4 : null

  if (tmdb === null && omdb === null) return 0.5   // no data → neutral
  if (tmdb === null) return (omdb! / 0.4) * 0.5   // re-normalize to full range
  if (omdb === null) return (tmdb / 0.6) * 0.5
  return tmdb + omdb
}

function recencyScore(releaseYear: number | null): number {
  if (!releaseYear) return 0
  const age = CURRENT_YEAR - releaseYear
  if (age <= 2) return 1.0
  if (age <= 5) return 0.5
  return 0.0
}

export async function scoreCandidates(
  candidates: TitleRow[],
  dna: DNASchema
): Promise<ScoredTitle[]> {
  if (candidates.length === 0) return []

  const candidateIds = candidates.map(t => t.tmdb_id)

  // ── Batch narrative match (1 pgvector RPC) ────────────────
  const narrativeScores = await computeNarrativeMatchScores(
    dna.strand_b_narrative_dimensions,
    dna.strand_c_visceral_specs,
    dna.metadata.user_id,
    dna.metadata.taste_version,
    candidateIds
  )

  // ── Pre-fetch lineage caches (0–2 DB queries) ────────────
  // For most new users, eligibleIds is empty → zero DB calls.
  const eligibleIds = getBoostEligibleIds(dna.strand_a_creative_affinity)
  let d1Cache: LineageCache = new Map()
  let d2Cache: LineageCache = new Map()

  if (eligibleIds.length > 0) {
    d1Cache = await fetchLineageCache(eligibleIds)

    // Collect all degree-1 influenced persons across the candidate set
    const degree1Ids = new Set<string>()
    for (const title of candidates) {
      const titleCrewIds = new Set([
        ...title.crew.directors.map(d => d.tmdb_person_id),
        ...title.crew.writers.map(w => w.tmdb_person_id),
        ...title.crew.cinematographers.map(dp => dp.tmdb_person_id),
      ])
      for (const [, row] of d1Cache) {
        for (const inf of (row.lineage_influences.influences ?? [])) {
          if (inf.id && titleCrewIds.has(inf.id)) {
            degree1Ids.add(inf.id)
          }
        }
      }
    }

    if (degree1Ids.size > 0) {
      d2Cache = await fetchLineageCache([...degree1Ids])
    }
  }

  // ── Score each candidate ──────────────────────────────────
  const scored: ScoredTitle[] = candidates.map(title => {
    const crewResult     = computeCrewAffinity(title.crew, dna.strand_a_creative_affinity)
    const lineageResult  = computeBoostFromCaches(title.crew, dna.strand_a_creative_affinity, d1Cache, d2Cache)
    const visceralResult = computeVisceralMatch(dna.strand_c_visceral_specs, title)

    const crew_affinity_score   = Math.min(1.0, crewResult.score + lineageResult.boost)
    const narrative_match_score = narrativeScores.get(title.tmdb_id) ?? 0.5
    const visceral_match_score  = visceralResult.score
    const external_rating_score = externalRatingScore(title)
    const recency_boost         = recencyScore(title.release_year)

    const composite_score =
      crew_affinity_score   * 0.35 +
      narrative_match_score * 0.30 +
      visceral_match_score  * 0.20 +
      external_rating_score * 0.10 +
      recency_boost         * 0.05

    return {
      title,
      crew_affinity_score,
      narrative_match_score,
      visceral_match_score,
      external_rating_score,
      recency_boost,
      composite_score,
      crew_matches:         crewResult.crew_matches,
      lineage_connections:  lineageResult.lineage_connections,
      dimension_matches:    visceralResult.dimension_matches,
      soft_preferences_applied: [],  // filled in Step 3
      groq_rationale:    '',          // filled in Step 4
      is_stretch_pick:   false,       // filled in Step 5
      stretch_rationale: null,
      dimensions_stretched: [],
    }
  })

  return scored.sort((a, b) => b.composite_score - a.composite_score)
}
