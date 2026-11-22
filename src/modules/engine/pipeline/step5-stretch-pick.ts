/**
 * Step 5 — Stretch Pick Injection
 *
 * Every 20th slot is replaced with a deliberate mismatch: a title with a
 * low composite score but a high external rating and a dimension mismatch.
 * The intent is to intentionally challenge the fingerprint and use the
 * user's accept/reject as a signal.
 *
 * Suppressed when:
 *   - signals.length < 15 (not enough fingerprint data — the product rule)
 *
 * It used to wait for 3 chat sessions too, but only a chat merge moves
 * total_sessions, so someone who only rates never got one (#416).
 *
 * One stretch pick per 20 slots: slot 20 of a 20-result list, slots 20 and
 * 40 of a 50-result list, the last slot of a list shorter than 20.
 * The stretch pick is labeled clearly — it is never hidden from the user.
 *
 * Stretch pick selection criteria:
 *   - composite_score < 0.4 (genuine mismatch on numeric scoring)
 *   - external_rating_score > 0.7 (high critical/audience quality)
 *
 * Order among those (#416): the least served first, so the pick changes from
 * one Refresh to the next; then one that also clashes with the user's
 * strand_b on a major dimension; then the best rated. Serve count outranks
 * quality on purpose: a 0.70 title never shown beats a 0.95 one shown twice,
 * and the 0.7 floor bounds what that costs. The clash used to be
 * required, but it counts only where strand_b's confidence is 0.4+, and
 * formula v2 doesn't score on strand_b, so for most people nothing passed.
 */

import type { DNASchema } from '@/types/dna'
import type { ScoredTitle } from '../types'

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
  ranked: ScoredTitle[],
  allCandidates: ScoredTitle[],
  dna: DNASchema
): ScoredTitle[] {
  // ── Suppression checks ────────────────────────────────────
  if (
    ranked.length === 0 ||
    dna.signals.length < SUPPRESS_BELOW_SIGNALS
  ) {
    return ranked  // too early (or nothing to inject into) — return unmodified
  }

  // ── Find stretch pick candidate ───────────────────────────
  // Look in the full candidate pool (not in ranked — those are already good fits)
  // Composite key — a movie and a TV show can share a tmdb_id
  const rankedIds = new Set(ranked.map(t => `${t.title.type}:${t.title.tmdb_id}`))

  // ── Slots: every 20th (20, 40, …), or the last slot for a shorter list ──
  // 1 in 20 is the product rule; batches grew to 50, so one pick was 1 in 50.
  const slots: number[] = []
  for (let i = 19; i < ranked.length; i += 20) slots.push(i)
  if (slots.length === 0) slots.push(ranked.length - 1)

  const stretchCandidates = allCandidates
    .filter(candidate =>
      !rankedIds.has(`${candidate.title.type}:${candidate.title.tmdb_id}`) &&  // already in list
      candidate.composite_score < MAX_COMPOSITE_SCORE &&
      candidate.external_rating_score >= MIN_EXTERNAL_RATING)
    .map(candidate => ({ candidate, clash: hasDimensionMismatch(candidate, dna).mismatched }))
    .sort((a, b) =>
      // `?? 0`, not step 3b's `?? 1`: step 1 sets times_served only on titles
      // served before (SEEN), so a FRESH title has none: it was served 0 times.
      (a.candidate.title.times_served ?? 0) - (b.candidate.title.times_served ?? 0) ||
      Number(b.clash) - Number(a.clash) ||
      b.candidate.external_rating_score - a.candidate.external_rating_score)
    .map(({ candidate }) => candidate)

  if (stretchCandidates.length === 0) return ranked   // no suitable stretch pick found

  // In place, keeping everything around each slot. Fewer distinct candidates
  // than slots fills the earliest slots only.
  const result = [...ranked]
  const used = new Set<string>()
  let next = 0
  for (const slot of slots) {
    while (next < stretchCandidates.length) {
      const c = stretchCandidates[next++]
      const key = `${c.title.type}:${c.title.tmdb_id}`
      if (used.has(key)) continue
      used.add(key)
      result[slot] = toStretchPick(c, dna)
      break
    }
  }
  return result
}

function toStretchPick(candidate: ScoredTitle, dna: DNASchema): ScoredTitle {
  const { dimensions_stretched } = hasDimensionMismatch(candidate, dna)

  // Build a plain-language stretch rationale
  const dimensionLabels = dimensions_stretched
    .map(d => d.replace(/_/g, ' '))
    .join(' and ')
  const why = dimensionLabels
    ? `this title scores lower on your usual ${dimensionLabels} preferences`
    : 'this title is outside what you usually go for'

  return {
    ...candidate,
    is_stretch_pick:  true,
    stretch_rationale: `Intentional stretch: ${why}. High critical rating. Accept or reject — both are useful signals.`,
    dimensions_stretched,
  }
}
