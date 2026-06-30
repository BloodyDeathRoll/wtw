import type { StrandB } from '@/types/dna'
import { loadDNA, saveDNA, bumpVersion } from './lib/load-save'
import { clamp } from './lib/reaction-score'

// Maps DeepSurvey label strings → internal NarrativeLevel / string values
const LABEL_TO_VALUE: Record<string, string> = {
  // moral_ambiguity
  'Clear-Cut':             'low',
  'Some Gray Areas':       'medium',
  'Often Murky':           'medium_high',
  'Deeply Ambiguous':      'high',
  // narrative_complexity
  'Straightforward':       'low',
  'Some Layers':           'medium',
  'Complex':               'medium_high',
  'Dense':                 'high',
  // emotional_demand
  'Low-Key':               'low',
  'Emotionally Present':   'medium',
  'Emotionally Demanding': 'medium_high',
  'Emotionally Intense':   'high',
  // humor_style
  'No Humor':              'none',
  'Dry / Subtle':          'dry',
  'Character Comedy':      'observational_character_driven',
  'Broad Comedy':          'slapstick',
  // protagonist_type
  'Flawed Hero':           'flawed_self_aware',
  'Anti-Hero':             'anti_hero',
  'Ensemble':              'ensemble',
  'Everyday Person':       'everyman',
  // ensemble_vs_solo
  'Strong Solo':           'strong_solo',
  'Slight Solo':           'slight_solo',
  'Balanced':              'neutral',
  'Slight Ensemble':       'slight_ensemble',
  'Strong Ensemble':       'strong_ensemble',
}

const ASPECT_DELTA: Record<'good' | 'ok' | 'weak', number> = {
  good: +0.05,
  ok:    0.00,
  weak: -0.03,
}

export async function updateSchemaFromSurvey(
  user_id: string,
  tmdb_id: string,
  dimension_ratings: Record<string, string>,
  aspect_ratings: Record<string, 'good' | 'ok' | 'weak'>,
): Promise<void> {
  const dna = await loadDNA(user_id)
  const strand_b = dna.strand_b_narrative_dimensions
  const strand_c = dna.strand_c_visceral_specs

  // 1. Dimension ratings → update strand_b values + confidence
  //    Deep survey is the highest-quality signal we have — weight it strongly
  for (const [dim, label] of Object.entries(dimension_ratings)) {
    const key = dim as keyof StrandB
    if (!(key in strand_b)) continue

    const mappedValue = LABEL_TO_VALUE[label]
    if (mappedValue) {
      strand_b[key].value      = mappedValue
      strand_b[key].confidence = clamp(strand_b[key].confidence + 0.12, 0, 1)
    } else {
      // Unknown label — user still engaged, so bump confidence a little
      strand_b[key].confidence = clamp(strand_b[key].confidence + 0.04, 0, 1)
    }
  }

  // 2. Aspect ratings → strand_c aspect_weights
  for (const [aspect, rating] of Object.entries(aspect_ratings)) {
    const key = aspect as keyof typeof strand_c.aspect_weights
    if (key in strand_c.aspect_weights) {
      strand_c.aspect_weights[key] = clamp(
        strand_c.aspect_weights[key] + ASPECT_DELTA[rating],
        0, 1,
      )
    }
  }

  // 3. Clear 'reason_needed' flag and boost confidence on the matching signal
  const signal = dna.signals.find(s => s.tmdb_id === tmdb_id)
  if (signal) {
    signal.flag       = null
    signal.confidence = clamp(signal.confidence + 0.1, 0, 1)
  }

  bumpVersion(dna)
  await saveDNA(user_id, dna)
}
