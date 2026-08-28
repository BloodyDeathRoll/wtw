/**
 * Visceral Match Scorer — Step 2, weight 0.20
 *
 * Compares the user's strand_c pacing and tone weights directly against
 * the title's LLM-extracted pacing_tag and tone_tags.
 *
 * Pure function — no I/O.
 *
 * Pacing (40% of visceral score):
 *   The title has one pacing_tag. The user's matching pacing_weight
 *   (already 0–1) becomes the pacing score directly.
 *   Null pacing_tag → 0.5 (neutral).
 *
 * Tone (60% of visceral score):
 *   For each of the title's tone_tags that appears in tone_weights,
 *   take the user's weight. Average those that match.
 *   No matching tones → 0.5 (neutral).
 *   tone_tags outside strand_c keys (e.g. 'melancholic') are ignored —
 *   no signal, no penalty.
 *
 * Also returns the soft_preferences_applied list for reason_payload,
 * so the caller doesn't have to redo the work.
 */

import type { StrandC, ReasonPayload } from '@/types/dna'
import type { TitleRow } from '../types'

export interface VisceralMatchResult {
  score: number                                         // 0.0 – 1.0
  dimension_matches: ReasonPayload['dimension_matches'] // pacing + tone matches
}

// Keys in strand_c that can match against title tone_tags
const TONE_KEYS: Array<keyof StrandC['tone_weights']> = [
  'cynical', 'warm', 'dark', 'comedic', 'hopeful',
]

/**
 * How far above or below the user's OWN average a weight sits, mapped back to
 * [0, 1] around 0.5. Weights are compared relatively, not absolutely: the
 * update rule only ever adds on a "loved", so after a few hundred ratings
 * every tone sat at 0.97–1.0 and every title scored a perfect 1.0 here
 * (measured 2026-08-28). What carries taste is which tones sit ABOVE the
 * others. GAIN stretches a typical ±0.3 spread over the full range.
 */
const RELATIVE_GAIN = 1.5

export function relativeWeight(weight: number, all: Record<string, number>): number {
  const values = Object.values(all)
  if (values.length === 0) return 0.5
  const mean = values.reduce((s, v) => s + v, 0) / values.length
  return Math.max(0, Math.min(1, 0.5 + (weight - mean) * RELATIVE_GAIN))
}

export function computeVisceralMatch(
  strandC: StrandC,
  title: Pick<TitleRow, 'pacing_tag' | 'tone_tags'>
): VisceralMatchResult {
  const dimension_matches: ReasonPayload['dimension_matches'] = []

  // ── Pacing ────────────────────────────────────────────────
  let pacingScore = 0.5  // neutral if tag is null (not yet enriched)
  if (title.pacing_tag) {
    const w = strandC.pacing_weights[title.pacing_tag]
    pacingScore = w == null ? 0.5 : relativeWeight(w, strandC.pacing_weights)
    dimension_matches.push({
      dimension: 'pacing',
      user_value: dominantPacing(strandC.pacing_weights),
      title_value: title.pacing_tag.replace('_', ' '),
    })
  }

  // ── Tone ──────────────────────────────────────────────────
  let toneScore = 0.5   // neutral if no overlap
  const matchedTones: { tag: string; weight: number }[] = []

  for (const tag of title.tone_tags) {
    // Only score tones that exist in strand_c
    if (TONE_KEYS.includes(tag as keyof StrandC['tone_weights'])) {
      const weight = strandC.tone_weights[tag as keyof StrandC['tone_weights']]
      matchedTones.push({ tag, weight: relativeWeight(weight, strandC.tone_weights) })
    }
  }

  if (matchedTones.length > 0) {
    toneScore = matchedTones.reduce((sum, t) => sum + t.weight, 0) / matchedTones.length
    dimension_matches.push({
      dimension: 'tone',
      user_value: dominantTone(strandC.tone_weights),
      title_value: matchedTones.map(t => t.tag).join(', '),
    })
  }

  const score = 0.40 * pacingScore + 0.60 * toneScore

  return { score, dimension_matches }
}

// ─────────────────────────────────────────────
// Helpers for dimension_matches human labels
// ─────────────────────────────────────────────

function dominantPacing(weights: StrandC['pacing_weights']): string {
  return Object.entries(weights)
    .sort(([, a], [, b]) => b - a)[0]?.[0]
    ?.replace('_', ' ') ?? 'moderate'
}

function dominantTone(weights: StrandC['tone_weights']): string {
  return Object.entries(weights)
    .filter(([, w]) => w > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 2)
    .map(([t]) => t)
    .join(', ') || 'neutral'
}
