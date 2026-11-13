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
import type { ScoredTitle, ReasonPayloadWithTaste } from '../types'
import { hasTasteFacts, sharedCatchKeys, tasteBars, tasteCatchKey, tasteNegatives, whatItsLike } from '../why/taste-facts'

export interface ScoredTitleWithPayload extends ScoredTitle {
  reason_payload: ReasonPayloadWithTaste
}

function buildNegativeSignals(item: ScoredTitle, catchShared = false): string[] {
  const negatives: string[] = []

  // v1 only: the sheet hides this line anyway (RecCard's NO_CREW_FILLER), and
  // under v2 it would take one of the two places from a real reason — and
  // "based on narrative and tone fit" isn't true of v2.
  if (!item.formula_v2 && item.crew_matches.length === 0) {
    negatives.push('No crew members from your watch history — recommendation is based on narrative and tone fit.')
  }

  if (item.formula_v2) {
    // Formula v2 (P1-E5): what the taste model holds against it, and a crowd
    // score well below the pool's. Narrative, visceral and genre habits have
    // weight 0 under v2, so they are no reason against.
    negatives.push(...tasteNegatives(item.formula_v2, catchShared))
    // Language is not a model input: keep it (the language catch, PLAN P1-E5).
    if (item.content_avoided?.dimension === 'language') negatives.push(`You have rated ${item.content_avoided.value} down before.`)
  } else {
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

    // The fingerprint's own answer to "why might they not want this" — the genre
    // (or language, or format) they have rated down repeatedly. Ahead of the
    // ratings caveat because it is about them, not about the title.
    if (item.content_avoided) {
      const { dimension, value } = item.content_avoided
      negatives.push(
        dimension === 'format'
          ? `You rate ${value === 'tv' ? 'series' : 'films'} lower than the other.`
          : `You have rated ${value} down before.`,
      )
    }

    if (item.external_rating_score < 0.55) {
      negatives.push('Lower critical/audience ratings than your usual picks.')
    }
  }

  if (item.is_stretch_pick && item.formula_v2) {
    // v2 (Eran, 2026-11-12, on #272): the stretched dimensions are strand B
    // names v2 doesn't use ("narrative complexity"), so it is said plainly.
    // dimensions_stretched itself is unchanged: the DNA writer records it.
    negatives.unshift('A stretch pick: chosen on purpose from outside what you usually go for.')
  } else if (item.is_stretch_pick && item.dimensions_stretched.length > 0) {
    const dims = item.dimensions_stretched.map(d => d.replace(/_/g, ' ')).join(', ')
    negatives.push(`Stretch pick — intentionally mismatches your profile on: ${dims}.`)
  }

  // Cap at 2 negatives to keep explanations from feeling discouraging
  return negatives.slice(0, 2)
}

export function buildReasonPayloads(
  items: ScoredTitle[]
): ScoredTitleWithPayload[] {
  // The catch each title would get, counted over the batch: one that most of
  // the batch shares says nothing, so it is left out (taste-facts.ts).
  const catchKeyOf = (item: ScoredTitle) => {
    const v2 = item.formula_v2
    return hasTasteFacts(v2) ? tasteCatchKey(v2.contributions, v2.vec, v2.rated_down_genres) : null
  }
  const shared = sharedCatchKeys(items.map(catchKeyOf))

  return items.map(item => {
    const key = catchKeyOf(item)
    const catchShared = key != null && shared.has(key)
    const t = item.title

    const external_ratings: ReasonPayload['external_ratings'] = []
    if (t.tmdb_rating != null) {
      external_ratings.push({ source: 'TMDB', score: t.tmdb_rating / 10 })
    }
    if (t.omdb_rating != null) {
      external_ratings.push({ source: 'OMDB (RT/Meta weighted)', score: t.omdb_rating })
    }

    const reason_payload: ReasonPayloadWithTaste = {
      crew_matches:              item.crew_matches,
      lineage_connections:       item.lineage_connections,
      dimension_matches:         item.dimension_matches,
      soft_preferences_applied:  item.soft_preferences_applied,
      external_ratings,
      is_stretch_pick:           item.is_stretch_pick,
      stretch_rationale:         item.stretch_rationale,
      groq_rationale:            item.groq_rationale,
      negative_signals:          buildNegativeSignals(item, catchShared),
    }
    const v2 = item.formula_v2
    if (v2) {
      // A title with no taste vector yet still has its three z-scores (its
      // model z is 0); it just has nothing to say about what it's like.
      const bars = tasteBars(v2)
      reason_payload.taste = {
        ...(bars ? { bars } : {}),
        like: hasTasteFacts(v2) ? whatItsLike(v2.vec, t.original_language) : [],
        ...(catchShared ? { catch_shared: true } : {}),
      }
    }

    return { ...item, reason_payload }
  })
}
