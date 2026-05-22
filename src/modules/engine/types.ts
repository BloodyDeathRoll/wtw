/**
 * WTW — Recommendation Engine: Internal Types
 *
 * These types are private to src/modules/engine/.
 * Public-facing types (RecommendationResult, etc.) live in src/types/dna.ts.
 */

import type { TMDBCrewSnapshot } from '@/lib/tmdb'

// ─────────────────────────────────────────────
// Database row shapes (match Supabase tables)
// ─────────────────────────────────────────────

export interface NarrativeDimensionMeta {
  value: string | number
  confidence: number
}

export interface TitleNarrativeMetadata {
  moral_ambiguity:      NarrativeDimensionMeta
  narrative_complexity: NarrativeDimensionMeta
  emotional_demand:     NarrativeDimensionMeta
  originality_weight:   NarrativeDimensionMeta
  humor_style:          NarrativeDimensionMeta
  protagonist_type:     NarrativeDimensionMeta
  ensemble_vs_solo:     NarrativeDimensionMeta
}

export interface TitleRow {
  id: number
  tmdb_id: string
  title: string
  type: 'movie' | 'tv'
  synopsis: string | null
  genres: { id: number; name: string }[]
  release_year: number | null
  runtime_minutes: number | null
  tmdb_rating: number | null
  tmdb_vote_count: number | null
  omdb_rating: number | null
  crew: TMDBCrewSnapshot
  pacing_tag: 'slow_burn' | 'moderate' | 'high_octane' | null
  tone_tags: string[]
  narrative_metadata: TitleNarrativeMetadata | null
  narrative_embedding: number[] | null  // 1024-dim Mistral vector
  enriched_at: string | null
  created_at: string
}

export interface CrewMemberRow {
  id: number
  tmdb_person_id: string
  name: string
  primary_role: 'director' | 'writer' | 'cinematographer' | 'actor' | null
  lineage_influences: {
    influences:   { id: string; name: string; relationship: string }[]
    influenced_by: { id: string; name: string; relationship: string }[]
  }
  enriched_at: string | null
  created_at: string
}

// ─────────────────────────────────────────────
// Pipeline-internal types
// ─────────────────────────────────────────────

/** A candidate title moving through the pipeline — accumulates data at each step. */
export interface ScoredTitle {
  title: TitleRow

  // ── Step 2: score components ───────────────────────────
  crew_affinity_score:    number    // 0.0 – 1.0 (includes lineage boost)
  narrative_match_score:  number    // 0.0 – 1.0
  visceral_match_score:   number    // 0.0 – 1.0
  external_rating_score:  number    // 0.0 – 1.0
  recency_boost:          number    // 0.0 – 1.0 (multiplied by 0.05 in composite)
  composite_score:        number    // weighted sum, 0.0 – 1.0

  // ── Step 2: reason payload sources ────────────────────
  crew_matches:           import('@/types/dna').ReasonPayload['crew_matches']
  lineage_connections:    import('@/types/dna').ReasonPayload['lineage_connections']
  dimension_matches:      import('@/types/dna').ReasonPayload['dimension_matches']

  // ── Step 3: filled by soft modifier application ────────
  soft_preferences_applied: import('@/types/dna').ReasonPayload['soft_preferences_applied']

  // ── Step 4: filled by LLM re-ranking ──────────────────
  groq_rationale: string

  // ── Step 5: filled by stretch pick injection ───────────
  is_stretch_pick:    boolean
  stretch_rationale:  string | null
  dimensions_stretched: string[]
}

/** What the Groq narrative extraction returns (after Zod parse). */
export interface NarrativeExtractionResult {
  pacing_tag: 'slow_burn' | 'moderate' | 'high_octane'
  tone_tags: string[]
  narrative_metadata: TitleNarrativeMetadata
}
