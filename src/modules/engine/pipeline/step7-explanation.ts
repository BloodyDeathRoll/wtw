/**
 * Step 7 — the "why" for each title, from facts only.
 *
 * Two texts per title, both built in step7-card-reason.ts:
 *   - `explanation` — the feed card's short line (`cardReason`): a person
 *     link, else the plot — the catalogue's own sentence, or for a plot too
 *     long for the card a one-sentence summary checked against it
 *     (card-plot.ts, the only model involved).
 *   - the "Why it's a match" sheet's fuller text (`sheetReason`), stored
 *     beside the batch by generate.ts (step8-cache.ts, `cacheWhyTexts`).
 *
 * Until 2026-11-06 the sheet showed a paragraph written by Mistral from a
 * short summary of the match. It filled the gaps with invented facts (live
 * 2026-11-05: Cruella's writer "wrote The Big Sick", its director made
 * "Brooklyn"; The Bad Guys "fast-paced" for a moderate-pace viewer), so it was
 * removed. Bringing a model back means feeding it the real credits and
 * checking what it writes — see docs/BACKLOG.md.
 */

import type { RecommendationResult } from '@/types/dna'
import type { ReasonPayloadWithTaste } from '../types'
import type { ScoredTitleWithPayload } from './step6-reason-payload'
import { cardReason, ratedCreators, ratedUnavailable, sheetReason, type RatedByPerson } from './step7-card-reason'

export { STRONG_CREW_AFFINITY } from './step7-card-reason'

/**
 * Scored+payload items → RecommendationResult, `explanation` = the card line.
 */
export function toResults(
  items: ScoredTitleWithPayload[],
  rated?: RatedByPerson,
  plots: Map<string, string> = new Map(),
): RecommendationResult[] {
  // Without your ratings (none passed, or the read failed) no one can be said
  // to be unrated: the payload goes without rated_creators, and the sheet
  // names its people the pre-F6 way instead of "Nobody you've rated".
  const known = rated && !ratedUnavailable(rated) ? rated : null
  const now = new Date().toISOString()
  return items.map(item => ({
    title:              item.title.title,
    tmdb_id:            item.title.tmdb_id,
    type:               item.title.type,
    composite_score:    item.match_score ?? item.composite_score,
    // + the people you rated, named under the Creators bar (v3 F6). The feed
    // (generate.ts) and one title on request (score-one.ts) both pass here.
    reason_payload:     known
      ? { ...item.reason_payload, rated_creators: ratedCreators(item, known) } as ReasonPayloadWithTaste
      : item.reason_payload,
    explanation:        cardReason(item, rated ?? new Map(), plots),
    is_stretch_pick:    item.is_stretch_pick,
    generated_at:       now,
    fingerprint_version: 0,   // set by generate.ts from dna.metadata.taste_version
  }))
}

/** The sheet's "Why" text per title, keyed `${type}:${tmdb_id}`. */
export function sheetTexts(
  items: ScoredTitleWithPayload[],
  rated: RatedByPerson = new Map(),
): Map<string, string> {
  return new Map(items.map(item => [`${item.title.type}:${item.title.tmdb_id}`, sheetReason(item, rated)]))
}
