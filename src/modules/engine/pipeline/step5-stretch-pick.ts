/**
 * Step 5 — Stretch Pick Injection
 *
 * Every 20th slot is replaced with a deliberate mismatch: a title with a
 * low composite score but a high external rating and a dimension mismatch.
 * The intent is to intentionally challenge the fingerprint and use the
 * user's accept/reject as a signal.
 *
 * Suppressed when:
 *   - total_sessions < 3  (user is too new)
 *   - signals.length < 15 (not enough fingerprint data)
 *
 * For a 20-result list there is exactly 1 stretch pick (slot 20).
 * The stretch pick is labeled clearly — it is never hidden from the user.
 *
 * Stretch pick selection criteria:
 *   - composite_score < 0.4 (genuine mismatch on numeric scoring)
 *   - external_rating_score > 0.7 (high critical/audience quality)
 *   - mismatches the user's strand_b on at least one major dimension
 */

import type { DNASchema } from '@/types/dna'
import type { ScoredTitle } from '../types'

const SUPPRESS_BELOW_SESSIONS = 3
const SUPPRESS_BELOW_SIGNALS  = 15
const MAX_COMPOSITE_SCORE     = 0.4
const MIN_EXTERNAL_RATING     = 0.7

// Strand_b dimensions considered "major" for mismatch detection
const MAJOR_DIMENSIONS: (keyof DNASchema['strand_b_narrative_dimensions'])[] = [
  'moral_ambiguity',
  'narrative_complexity',
  'emotional_demand',
]

// Map enum values to a numeric scale for comparison
const LEVEL_RANK: Record<string, number> = {
  low: 0, medium: 1, medium_high: 2, high: 3,
}

function hasDimensionMismatch(
  title: ScoredTitle,
  dna: DNASchema
): { mismatched: boolean; dimensions_stretched: string[] } {
  const dimensions_stretched: string[] = []

  for (const dim of MAJOR_DIMENSIONS) {
    const userDim  = dna.strand_b_narrative_dimensions[dim]
    const titleMeta = title.title.narrative_metadata

    if (!titleMeta || userDim.confidence < 0.4) continue  // not enough signal to judge

    const userVal  = LEVEL_RANK[String(userDim.value)] ?? -1
    const titleVal = LEVEL_RANK[String(titleMeta[dim]?.value ?? '')] ?? -1

    if (userVal === -1 || titleVal === -1) continue

    // A "mismatch" is a gap of 2+ levels (e.g. user=high, title=low)
    if (Math.abs(userVal - titleVal) >= 2) {
      dimensions_stretched.push(dim)
    }
  }

  return {
    mismatched: dimensions_stretched.length > 0,
    dimensions_stretched,
  }
}

export function injectStretchPick(
  top20: ScoredTitle[],
  allCandidates: ScoredTitle[],
  dna: DNASchema
): ScoredTitle[] {
  // ── Suppression checks ────────────────────────────────────
  if (
    dna.metadata.total_sessions < SUPPRESS_BELOW_SESSIONS ||
    dna.signals.length < SUPPRESS_BELOW_SIGNALS
  ) {
    return top20  // too early — return unmodified
  }

  // ── Find stretch pick candidate ───────────────────────────
  // Look in the full candidate pool (not in top20 — those are already good fits)
  const top20Ids = new Set(top20.map(t => t.title.tmdb_id))

  const stretchCandidate = allCandidates.find(candidate => {
    if (top20Ids.has(candidate.title.tmdb_id))       return false  // already in list
    if (candidate.composite_score >= MAX_COMPOSITE_SCORE) return false
    if (candidate.external_rating_score < MIN_EXTERNAL_RATING) return false
    const { mismatched } = hasDimensionMismatch(candidate, dna)
    return mismatched
  })

  if (!stretchCandidate) return top20   // no suitable stretch pick found

  const { dimensions_stretched } = hasDimensionMismatch(stretchCandidate, dna)

  // Build a plain-language stretch rationale
  const dimensionLabels = dimensions_stretched
    .map(d => d.replace(/_/g, ' '))
    .join(' and ')

  const stretchPick: ScoredTitle = {
    ...stretchCandidate,
    is_stretch_pick:  true,
    stretch_rationale: `Intentional stretch: this title scores lower on your usual ${dimensionLabels} preferences. High critical rating. Accept or reject — both are useful signals.`,
    dimensions_stretched,
  }

  // ── Replace slot 20 (last position) ─────────────────────
  const result = [...top20.slice(0, 19), stretchPick]
  return result
}
