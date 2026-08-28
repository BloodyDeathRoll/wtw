/**
 * applyStrandBFromTitle — let card ratings teach strand B.
 *
 * Until 2026-08-28 strand B (moral ambiguity, complexity, humor style…) only
 * moved when the chat extraction said so; applySignalDimensionTags reads
 * `dimensions_reinforced`, which card ratings leave empty. A user with 250
 * card ratings still had every dimension at its blank default ("medium",
 * "none", "everyman"), so the fingerprint embedding described nobody and
 * narrative matching surfaced generic titles.
 *
 * Every enriched title carries the same seven dimensions with a per-dimension
 * confidence (titles.narrative_metadata, enrich-title-narrative.ts). Rule:
 *
 *   loved / liked, title says X:
 *     current value is X  → confidence up
 *     current value isn't → confidence down; when it hits 0 the user has
 *                           out-voted the old value: adopt X at low confidence
 *   disliked, title says X:
 *     current value is X  → confidence down (this is evidence AGAINST X)
 *     otherwise           → nothing — disliking "high" says nothing about "medium"
 *   originality_weight is numeric: move toward the title's value on a
 *     positive reaction, away on a negative one.
 *
 * Deltas scale with the title's own confidence in the dimension; below
 * MIN_TITLE_CONFIDENCE the tag is too weak to count. Notes are untouched —
 * rewriteChangedDimensionNotes handles prose at session end.
 */

import type { StrandB, Reaction, NarrativeDimension } from '@/types/dna'
import { clamp } from './reaction-score'

export type TitleNarrativeMetadata = Partial<Record<keyof StrandB, { value: unknown; confidence?: number }>>

const DELTA: Record<Reaction, number> = {
  loved:    +0.06,
  liked:    +0.03,
  disliked: -0.04,
}
const MIN_TITLE_CONFIDENCE = 0.4
/** Confidence a freshly adopted value starts at. */
const ADOPT_CONFIDENCE = 0.2
/** Fraction of the gap a numeric dimension moves per loved title. */
const NUMERIC_STEP = 2

const DIMENSIONS: (keyof StrandB)[] = [
  'moral_ambiguity', 'narrative_complexity', 'emotional_demand', 'originality_weight',
  'humor_style', 'protagonist_type', 'ensemble_vs_solo',
]

export function applyStrandBFromTitle(
  strand_b: StrandB,
  metadata: TitleNarrativeMetadata | null | undefined,
  reaction: Reaction,
): number {
  if (!metadata) return 0
  // Legacy signals can carry a reaction that no longer exists ('mixed', dropped
  // in migration 0013); indexing DELTA with it gives undefined → NaN everywhere.
  const base = DELTA[reaction]
  if (base == null) return 0
  let touched = 0

  for (const dim of DIMENSIONS) {
    const tag = metadata[dim]
    const current: NarrativeDimension | undefined = strand_b[dim]
    if (!tag || !current || tag.value == null) continue
    // Some enriched rows carry a non-numeric confidence (seen live: a word
    // where a number belongs) — one NaN here poisons the dimension for good.
    const titleConf = Number(tag.confidence)
    if (!Number.isFinite(titleConf) || titleConf < MIN_TITLE_CONFIDENCE) continue

    const delta = base * titleConf
    touched++

    if (typeof tag.value === 'number' && typeof current.value === 'number') {
      if (!Number.isFinite(tag.value)) continue
      const gap = tag.value - current.value
      if (delta > 0) {
        current.value = clamp(current.value + gap * delta * NUMERIC_STEP, 0, 1)
        current.confidence = clamp(current.confidence + delta, 0, 1)
      } else {
        current.value = clamp(current.value - gap * Math.abs(delta), 0, 1)
      }
      continue
    }

    const same = String(tag.value) === String(current.value)
    if (delta > 0) {
      if (same) {
        current.confidence = clamp(current.confidence + delta, 0, 1)
      } else {
        current.confidence = clamp(current.confidence - delta, 0, 1)
        if (current.confidence <= 0) {
          current.value = tag.value as NarrativeDimension['value']
          current.confidence = ADOPT_CONFIDENCE
        }
      }
    } else if (same) {
      current.confidence = clamp(current.confidence + delta, 0, 1) // delta < 0
    }
  }
  return touched
}
