import type { DNASchema } from '@/types/dna'

export function createBlankDNA(user_id: string): DNASchema {
  const now = new Date().toISOString()
  return {
    metadata: {
      user_id,
      schema_version: '1.2',
      taste_version: 1,
      last_updated: now,
      total_sessions: 0,
      fingerprint_embedding_ref: '',
    },
    strand_a_creative_affinity: {
      directors:        {},
      writers:          {},
      cinematographers: {},
      actors:           {},
    },
    strand_b_narrative_dimensions: {
      moral_ambiguity:      { value: 'medium',   confidence: 0, notes: '' },
      narrative_complexity: { value: 'medium',   confidence: 0, notes: '' },
      emotional_demand:     { value: 'medium',   confidence: 0, notes: '' },
      originality_weight:   { value: 0.5,        confidence: 0, notes: '' },
      humor_style:          { value: 'none',     confidence: 0, notes: '' },
      protagonist_type:     { value: 'everyman', confidence: 0, notes: '' },
      ensemble_vs_solo:     { value: 'neutral',  confidence: 0, notes: '' },
    },
    strand_c_visceral_specs: {
      pacing_weights: {
        slow_burn:   0.33,
        moderate:    0.34,
        high_octane: 0.33,
      },
      tone_weights: {
        cynical:  0.2,
        warm:     0.2,
        dark:     0.2,
        comedic:  0.2,
        hopeful:  0.2,
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
    },
    contextual_logic: {
      exclusion_rules:    [],
      soft_preferences:   [],
      temporal_modifiers: [],
    },
    signals: [],
    learning_loop: {
      open_questions:         [],
      temporal_decay_applied: false,
      stretch_pick_history:   [],
      recommendation_history: [],
    },
  }
}
