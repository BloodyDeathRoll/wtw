/**
 * Step 3 — Soft Preference Modifiers ("Less of", DEC-6)
 *
 * Applies contextual_logic.soft_preferences as score multipliers.
 * A weight_modifier of 0.7 means "reduce score by 30% for titles matching this signal."
 * These are not eliminations — they adjust ranking only. Under formula v2
 * the composite is still in (0,1), so × weight_modifier still sinks a title.
 *
 * Re-sorts by composite_score after modification.
 *
 * The temporal-modifier block ("something light tonight" → boost / suppress
 * a tone for the session) was removed in P1-E4: only the chat ever wrote
 * temporal_modifiers, and the chat no longer touches the ranking (DEC-5,
 * P1-C1 cleared them from every fingerprint).
 */

import { matchesSoftSignal } from '@/lib/exclusion-rules'
import type { DNASchema } from '@/types/dna'
import type { ScoredTitle } from '../types'

export function applySoftModifiers(
  scored: ScoredTitle[],
  dna: DNASchema,
): ScoredTitle[] {
  const { soft_preferences } = dna.contextual_logic

  return scored
    .map(item => {
      let score = item.composite_score
      const applied: ScoredTitle['soft_preferences_applied'] = []

      for (const pref of soft_preferences) {
        // Exact match only, like a rule (P1-C2): a genre its TMDB genres, a
        // keyword that keyword, a person their credits (src/lib/exclusion-rules.ts).
        if (matchesSoftSignal(item.title, pref.signal, pref)) {
          score *= pref.weight_modifier
          applied.push({ signal: pref.signal, modifier: pref.weight_modifier })
        }
      }

      return {
        ...item,
        composite_score: score,
        soft_preferences_applied: applied,
      }
    })
    .sort((a, b) => b.composite_score - a.composite_score)
}
