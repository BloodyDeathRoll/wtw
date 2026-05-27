import type {
  DNASchema,
  DNAMetadata,
  StrandA,
  StrandB,
  StrandC,
  ContextualLogic,
  LearningLoop,
} from '@/types/dna'

const SCHEMA_VERSION = '1.2'

function emptyStrandA(): StrandA {
  return {
    directors: {},
    writers: {},
    cinematographers: {},
    actors: {},
  }
}

function emptyStrandB(): StrandB {
  return {
    moral_ambiguity:      { value: 'medium', confidence: 0, notes: '' },
    narrative_complexity: { value: 'medium', confidence: 0, notes: '' },
    emotional_demand:     { value: 'medium', confidence: 0, notes: '' },
    originality_weight:   { value: 0.5,      confidence: 0, notes: '' },
    humor_style:          { value: 'none',   confidence: 0, notes: '' },
    protagonist_type:     { value: 'everyman', confidence: 0, notes: '' },
    ensemble_vs_solo:     { value: 'neutral', confidence: 0, notes: '' },
  }
}

function emptyStrandC(): StrandC {
  return {
    pacing_weights: {
      slow_burn:   0.5,
      moderate:    0.5,
      high_octane: 0.5,
    },
    tone_weights: {
      cynical:  0.5,
      warm:     0.5,
      dark:     0.5,
      comedic:  0.5,
      hopeful:  0.5,
    },
    aspect_weights: {
      cinematography: 0.5,
      dialogue:       0.5,
      pacing:         0.5,
      acting:         0.5,
      world_building: 0.5,
      score_music:    0.5,
      direction:      0.5,
      originality:    0.5,
      themes:         0.5,
      story:          0.5,
      tone:           0.5,
      rewatchability: 0.5,
    },
  }
}

function emptyContextualLogic(): ContextualLogic {
  return {
    exclusion_rules:    [],
    soft_preferences:   [],
    temporal_modifiers: [],
  }
}

function emptyLearningLoop(): LearningLoop {
  return {
    open_questions:         [],
    temporal_decay_applied: false,
    stretch_pick_history:   [],
    recommendation_history: [],
  }
}

/**
 * Builds a fresh DNASchema for a new user.
 * All weights default to 0.5 (neutral), all confidence values to 0.
 * Called by the onboarding flow before any signals exist.
 */
export function buildEmptyDNA(userId: string): DNASchema {
  const now = new Date().toISOString()

  const metadata: DNAMetadata = {
    user_id:                   userId,
    schema_version:            SCHEMA_VERSION,
    taste_version:             0,
    last_updated:              now,
    total_sessions:            0,
    fingerprint_embedding_ref: '',
  }

  return {
    metadata,
    strand_a_creative_affinity:    emptyStrandA(),
    strand_b_narrative_dimensions: emptyStrandB(),
    strand_c_visceral_specs:       emptyStrandC(),
    contextual_logic:              emptyContextualLogic(),
    signals:                       [],
    learning_loop:                 emptyLearningLoop(),
  }
}
