/**
 * Step 3 — Soft preferences: Less / More / Much more (DEC-6; P2-U8)
 *
 * Applies contextual_logic.soft_preferences to the ranking. A preference's
 * weight_modifier multiplies a matching title's ODDS of making the feed:
 *
 *   odds = c / (1 − c)  →  odds × weight  →  c' = odds' / (1 + odds')
 *
 * Why odds and not the score itself (decided 2026-11-13, P2-U8): under
 * formula v2 the composite is Φ of a z-sum, so it is close to the title's
 * place in its pool (0.9 = better than 90% of it). A plain × 0.7 capped every
 * matching title at 0.7, below the cut for a 50-title batch from a pool of
 * 150–300, so "Less of" emptied the genre from the feed (simulated: a genre
 * that is a quarter of the pool went from 25% of the batch to 0–11%). On odds
 * the same title keeps its order inside the genre and only moves against the
 * rest, by the same amount up (weight > 1) as down (weight < 1). Weights:
 * src/lib/genre-calls.ts.
 *
 * Not eliminations: they adjust ranking only. The score the card shows (and
 * the served score the live score reads) stays the one before this step
 * (`match_score`): turning a genre up must not make its titles claim a better
 * match than they are.
 *
 * Re-sorts by composite_score after modification.
 */

import { matchesSoftSignal } from '@/lib/exclusion-rules'
import type { DNASchema } from '@/types/dna'
import type { ScoredTitle } from '../types'

/** Keeps a score of exactly 0 or 1 away from the odds' poles. */
const EDGE = 1e-6

export function applyOdds(score: number, weight: number): number {
  const c = Math.min(1 - EDGE, Math.max(EDGE, score))
  const odds = (c / (1 - c)) * Math.max(0, weight)
  return odds / (1 + odds)
}

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
        if (!Number.isFinite(pref.weight_modifier) || pref.weight_modifier === 1) continue
        // Exact match only, like a rule (P1-C2): a genre its TMDB genres (or,
        // for a call on one of the 16, exactly that genre), a keyword that
        // keyword, a person their credits (src/lib/exclusion-rules.ts).
        if (matchesSoftSignal(item.title, pref.signal, pref)) {
          score = applyOdds(score, pref.weight_modifier)
          applied.push({ signal: pref.signal, modifier: pref.weight_modifier })
        }
      }
      if (applied.length === 0) return item

      return {
        ...item,
        match_score: item.match_score ?? item.composite_score,
        composite_score: score,
        soft_preferences_applied: applied,
      }
    })
    .sort((a, b) => b.composite_score - a.composite_score)
}
