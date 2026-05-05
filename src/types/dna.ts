/**
 * WTW — What To Watch
 * src/types/dna.ts
 *
 * ⚠️  SHARED CONTRACT — All three modules depend on these types.
 *     Any change requires review and approval from all three collaborators.
 *     Do not rename fields, change types, or add required fields without team agreement.
 */

// ─────────────────────────────────────────────
// STRAND A — Creative Affinity
// ─────────────────────────────────────────────

export type LineageBoost = 'none' | 'low' | 'medium' | 'high'

export interface CrewAffinityEntry {
  name: string
  score: number          // -1.0 to 1.0
  confidence: number     // 0.0 to 1.0
  sample_size: number
  lineage_boost: LineageBoost
}

export interface StrandA {
  directors: Record<string, CrewAffinityEntry>      // keyed by TMDB person ID
  writers: Record<string, CrewAffinityEntry>
  cinematographers: Record<string, CrewAffinityEntry>
  actors: Record<string, CrewAffinityEntry>
}

// ─────────────────────────────────────────────
// STRAND B — Narrative Dimensions
// ─────────────────────────────────────────────

export type NarrativeLevel = 'low' | 'medium' | 'medium_high' | 'high'

export interface NarrativeDimension {
  value: NarrativeLevel | string | number
  confidence: number    // 0.0 to 1.0
  notes: string         // plain English, updated by LLM
}

export interface StrandB {
  moral_ambiguity: NarrativeDimension
  narrative_complexity: NarrativeDimension
  emotional_demand: NarrativeDimension
  originality_weight: NarrativeDimension
  humor_style: NarrativeDimension
  protagonist_type: NarrativeDimension
  ensemble_vs_solo: NarrativeDimension
}

// ─────────────────────────────────────────────
// STRAND C — Visceral Specs
// ─────────────────────────────────────────────

export interface StrandC {
  pacing_weights: {
    slow_burn: number
    moderate: number
    high_octane: number
  }
  tone_weights: {
    cynical: number
    warm: number
    dark: number
    comedic: number
    hopeful: number
  }
  aspect_weights: {
    cinematography: number
    dialogue: number
    pacing: number
    acting: number
    world_building: number
    score_music: number
    direction: number
    originality: number
    themes: number
    story: number
    tone: number
    rewatchability: number
  }
}

// ─────────────────────────────────────────────
// CONTEXTUAL LOGIC
// ─────────────────────────────────────────────

export type ExclusionType = 'person' | 'genre' | 'keyword' | 'franchise'

export interface ExclusionRule {
  type: ExclusionType
  id: string
  name: string
  raw: string      // original free-text from user
  reason: string   // parsed intent
}

export interface SoftPreference {
  signal: string
  weight_modifier: number   // 0.0 to 1.0
}

export interface TemporalModifier {
  condition: string    // e.g. 'evening_tired', 'date_night'
  boost: string
  suppress: string
}

export interface ContextualLogic {
  exclusion_rules: ExclusionRule[]
  soft_preferences: SoftPreference[]
  temporal_modifiers: TemporalModifier[]
}

// ─────────────────────────────────────────────
// SIGNALS
// ─────────────────────────────────────────────

export type Reaction = 'loved' | 'liked' | 'mixed' | 'disliked'
export type RegretSignal = 'glad_watched' | 'neutral' | 'regret'
export type SignalSource = 'onboarding' | `session_${number}` | 'recommendation_accepted' | 'manual'
export type SignalFlag = 'reason_needed' | 'rewatch_candidate' | 'contradicts_profile'

export interface DNASignal {
  title: string
  tmdb_id: string
  type: 'movie' | 'tv'
  reaction: Reaction
  quick_rating: number | null       // 1–5
  regret_signal: RegretSignal | null
  source: SignalSource
  reason: string
  dimensions_reinforced: (keyof StrandB)[]
  dimensions_contradicted: (keyof StrandB)[]
  confidence: number
  flag: SignalFlag | null
  watched_at: string | null         // ISO-8601
}

// ─────────────────────────────────────────────
// LEARNING LOOP
// ─────────────────────────────────────────────

export interface StretchPickRecord {
  title: string
  tmdb_id: string
  accepted: boolean
  reaction: Reaction | null
  session: number
  dimensions_stretched: string[]
}

export interface RecommendationRecord {
  session: number
  recommended: string
  tmdb_id: string
  accepted: boolean
  watched: boolean
  rating: Reaction | null
  fingerprint_version: number
}

export interface LearningLoop {
  open_questions: string[]
  temporal_decay_applied: boolean
  stretch_pick_history: StretchPickRecord[]
  recommendation_history: RecommendationRecord[]
}

// ─────────────────────────────────────────────
// FULL DNA SCHEMA
// ─────────────────────────────────────────────

export interface DNAMetadata {
  user_id: string
  schema_version: string
  taste_version: number
  last_updated: string              // ISO-8601
  total_sessions: number
  fingerprint_embedding_ref: string
}

export interface DNASchema {
  metadata: DNAMetadata
  strand_a_creative_affinity: StrandA
  strand_b_narrative_dimensions: StrandB
  strand_c_visceral_specs: StrandC
  contextual_logic: ContextualLogic
  signals: DNASignal[]
  learning_loop: LearningLoop
}

// ─────────────────────────────────────────────
// INTER-MODULE INTERFACES
// These are the contracts between the three assignments.
// ─────────────────────────────────────────────

/**
 * Produced by Assignment 1 (Session Brain)
 * Consumed by Assignment 3 (DNA Schema Writer)
 * Passed after every session ends.
 */
export interface SessionSummary {
  session_number: number
  new_signals: DNASignal[]
  dimension_updates: Partial<StrandB>
  open_questions_resolved: string[]
  new_open_questions: string[]
  recommendation_made: string | null
  recommendation_accepted: boolean | null
}

/**
 * Produced by Assignment 1 (Session Brain)
 * Consumed by Assignment 2 (Recommendation Engine)
 * Passed when generating recommendations for a session.
 */
export interface SessionContext {
  current_mood_signal: string | null
  immediate_request: string | null
  session_override_active: boolean
}

/**
 * The reason breakdown stored with every recommendation.
 * Built by Assignment 2, consumed by Assignment 1 (Why this? button)
 * and Assignment 3 (feedback processing).
 */
export interface ReasonPayload {
  crew_matches: {
    name: string
    role: string
    affinity_score: number
  }[]
  lineage_connections: {
    from: string
    to: string
    relationship: string
  }[]
  dimension_matches: {
    dimension: string
    user_value: string
    title_value: string
  }[]
  soft_preferences_applied: {
    signal: string
    modifier: number
  }[]
  external_ratings: {
    source: string
    score: number
  }[]
  is_stretch_pick: boolean
  stretch_rationale: string | null
  groq_rationale: string
  negative_signals: string[]
}

/**
 * Produced by Assignment 2 (Recommendation Engine)
 * Consumed by Assignment 1 (display) and Assignment 3 (feedback loop)
 */
export interface RecommendationResult {
  title: string
  tmdb_id: string
  type: 'movie' | 'tv'
  composite_score: number
  reason_payload: ReasonPayload
  explanation: string
  is_stretch_pick: boolean
  generated_at: string
  fingerprint_version: number
}

/**
 * Extended result for co-watch sessions.
 * Produced by Assignment 2 when called with two DNA schemas.
 */
export interface CowatchResult extends RecommendationResult {
  score_user_a: number
  score_user_b: number
  cowatch_explanation: string
}
