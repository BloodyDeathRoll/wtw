/**
 * Step 6 — Reason Payload Assembly
 *
 * Assembles the full ReasonPayload for each title from data accumulated
 * during Steps 2–5. Also computes negative_signals: honest signals about
 * what DIDN'T fire or what the user might find problematic.
 *
 * negative_signals examples:
 *   - "Director not in your watch history"
 *   - "Slower pacing than you typically rate highly"
 *   - "Lower external ratings than your usual picks"
 *   - Stretch pick: its specific dimension mismatches
 */

import type { ReasonPayload } from '@/types/dna'
import type { ScoredTitle } from '../types'

export interface ScoredTitleWithPayload extends ScoredTitle {
  reason_payload: ReasonPayload
}

function buildNegativeSignals(item: ScoredTitle): string[] {
  const negatives: string[] = []

  if (item.crew_matches.length === 0) {
    negatives.push('No crew members from your watch history — recommendation is based on narrative and tone fit.')
  }

  if (item.narrative_match_score < 0.45) {
    negatives.push('Narrative dimensions are a partial mismatch with your usual preferences.')
  }

  if (item.visceral_match_score < 0.4) {
    const tag = item.title.pacing_tag?.replace('_', ' ')
    if (tag) {
      negatives.push(`Pacing (${tag}) differs from what you typically rate highly.`)
    } else {
      negatives.push('Tone differs from your usual preferences.')
    }
  }

  if (item.external_rating_score < 0.55) {
    negatives.push('Lower critical/audience ratings than your usual picks.')
  }

  if (item.is_stretch_pick && item.dimensions_stretched.length > 0) {
    const dims = item.dimensions_stretched.map(d => d.replace(/_/g, ' ')).join(', ')
    negatives.push(`Stretch pick — intentionally mismatches your profile on: ${dims}.`)
  }

  // Cap at 2 negatives to keep explanations from feeling discouraging
  return negatives.slice(0, 2)
}

export function buildReasonPayloads(
  items: ScoredTitle[]
): ScoredTitleWithPayload[] {
  return items.map(item => {
    const t = item.title

    const external_ratings: ReasonPayload['external_ratings'] = []
    if (t.tmdb_rating != null) {
      external_ratings.push({ source: 'TMDB', score: t.tmdb_rating / 10 })
    }
    if (t.omdb_rating != null) {
      external_ratings.push({ source: 'OMDB (RT/Meta weighted)', score: t.omdb_rating })
    }

    const reason_payload: ReasonPayload = {
      crew_matches:              item.crew_matches,
      lineage_connections:       item.lineage_connections,
      dimension_matches:         item.dimension_matches,
      soft_preferences_applied:  item.soft_preferences_applied,
      external_ratings,
      is_stretch_pick:           item.is_stretch_pick,
      stretch_rationale:         item.stretch_rationale,
      groq_rationale:            item.groq_rationale,
      negative_signals:          buildNegativeSignals(item),
    }

    return { ...item, reason_payload }
  })
}
