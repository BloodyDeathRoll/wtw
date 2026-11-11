/**
 * Step 4 — Jev filter (was: LLM re-ranking)
 *
 * Takes the top 50 scored candidates and asks Jev (`src/lib/jev.ts`), per
 * candidate, whether THIS viewer would dislike it — the nuance numeric
 * scoring can't capture, above all the avoid list (see `avoidSummary`).
 * Candidates Jev is ≥ `JEV_DISLIKE_THRESHOLD` sure about are dropped.
 *
 * Nothing is reordered (2026-11-05). Until then this step asked Mistral to
 * re-rank the batch by taste, so a 94% match could show above a 95% one.
 * The product rule is that the card's % match IS the order: composite
 * order in, composite order out, minus what Jev drops. One Jev request for
 * the whole batch, ~0.4s measured live, against 5–20s for the LLM rerank.
 *
 * On any Jev failure (no key, non-2xx, timeout, bad body) the batch is
 * returned untouched and the failure is logged to Redis (`recordJevFailure`)
 * so the devs see it on their next app open / Claude Code session.
 *
 * groq_rationale is kept on the type (ReasonPayload contract) and is
 * always ''.
 *
 * The prompt carries what the viewer AVOIDS as well as what they like
 * (2026-09-20). It used to be an entirely positive profile, so a reranker with
 * no idea the user had said "no anime" five times could promote an anime to
 * the top of the batch on tonal resonance alone.
 */

import { after } from 'next/server'
import { jevNoul, recordJevFailure, JevNotConfigured } from '@/lib/jev'
import { strongestContentAffinities } from '@/modules/dna/lib/update-content-affinity'
import type { DNASchema } from '@/types/dna'
import type { ScoredTitle } from '../types'

// ─────────────────────────────────────────────
// Profile → natural language (for the prompt)
// ─────────────────────────────────────────────

/** A crew member needs at least this many ratings to be named a favourite. */
export const FAVOURITE_CREW_MIN_SAMPLES = 2

export function profileSummary(dna: DNASchema): string {
  const b = dna.strand_b_narrative_dimensions
  const c = dna.strand_c_visceral_specs

  // Top crew affinities: liked on balance, rated at least twice, strongest
  // score × confidence first. A strand A score is a running average reaction
  // level that tops out at +0.30 (src/modules/dna/lib/reaction-score.ts), so
  // the old `score > 0.3` left this line empty for almost everyone (P1-E2).
  const topCrew = [
    ...Object.values(dna.strand_a_creative_affinity.directors).map(e => ({ ...e, role: 'director' })),
    ...Object.values(dna.strand_a_creative_affinity.writers).map(e => ({ ...e, role: 'writer' })),
    ...Object.values(dna.strand_a_creative_affinity.cinematographers).map(e => ({ ...e, role: 'cinematographer' })),
  ]
    .filter(e => e.score > 0 && e.sample_size >= FAVOURITE_CREW_MIN_SAMPLES)
    .sort((a, b) => (b.score * b.confidence) - (a.score * a.confidence))
    .slice(0, 5)
    .map(e => `${e.name} (${e.role}, affinity ${(e.score * e.confidence).toFixed(2)})`)
    .join(', ')

  const dominantPacing = Object.entries(c.pacing_weights)
    .sort(([, a], [, b]) => b - a)[0]?.[0]?.replace('_', ' ') ?? 'unknown'

  const dominantTones = Object.entries(c.tone_weights)
    .filter(([, w]) => w > 0.3)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([t]) => t)
    .join(', ')

  return [
    topCrew ? `Favorite crew: ${topCrew}.` : '',
    `Prefers ${b.moral_ambiguity.value} moral ambiguity, ${b.narrative_complexity.value} narrative complexity.`,
    `Emotional demand preference: ${b.emotional_demand.value}.`,
    `Protagonist type: ${b.protagonist_type.value}.`,
    `Ensemble vs solo: ${b.ensemble_vs_solo.value}.`,
    `Pacing: favors ${dominantPacing}.`,
    dominantTones ? `Tone: gravitates toward ${dominantTones}.` : '',
  ].filter(Boolean).join(' ')
}

/**
 * What the viewer does NOT want — and the reason this function exists
 * (2026-09-06): the profile above is entirely positive, so the reranker was
 * free to promote an anime for someone who had said "no anime" in five
 * separate sessions. The SQL pass already removes anything a hard rule
 * excludes, but two things survive it and still need saying:
 *
 *   - a soft preference, which is a reduction and not a cut;
 *   - a genre the user has quietly rated down without ever naming it
 *     (strand_c genre/language affinity).
 *
 * Hard exclusions are listed anyway. They cost one line, and a candidate list
 * that contradicts a stated rule means the rule failed to widen into anything
 * the catalog could be filtered on — in which case the reranker is the last
 * thing standing between the user and the batch they asked not to get.
 */
export function avoidSummary(dna: DNASchema): string {
  const logic = dna.contextual_logic
  const parts: string[] = []

  const never = logic.exclusion_rules.map(r => r.name).filter(Boolean)
  if (never.length > 0) parts.push(`NEVER wants: ${never.join(', ')}.`)

  const less = logic.soft_preferences
    .filter(p => p.weight_modifier < 1)
    .sort((a, b) => a.weight_modifier - b.weight_modifier)
    .map(p => p.signal)
    .filter(Boolean)
  if (less.length > 0) parts.push(`Wants less of: ${less.join(', ')}.`)

  const c = dna.strand_c_visceral_specs
  // Merge, THEN rank, then slice. `strongestContentAffinities` orders within
  // its own bucket, so concatenating two sorted lists and slicing the front
  // dropped every language once five genres were disliked, however much
  // stronger the language signal was.
  //
  // Ranked by score × confidence, like topCrew above, and NOT by score alone:
  // score is a running average reaction level, so everything the user has
  // always disliked converges on the same −0.20 whether it was rated 4 times
  // or 40. Confidence is what carries "how sure are we".
  //
  // Only the key is printed (P1-E2). It used to print `sample_size` as
  // "N rated down", but sample_size counts every rating of that genre, likes
  // included, and any genre averaging below 0 was listed. Now a genre must
  // average at or below RATED_DOWN_MAX_SCORE over RATED_DOWN_MIN_SAMPLES+
  // ratings — mostly dislikes, not a mixed bag.
  const ratedDown = [
    ...strongestContentAffinities(c.genre_affinity, RATED_DOWN_MIN_SAMPLES),
    ...strongestContentAffinities(c.language_affinity, RATED_DOWN_MIN_SAMPLES),
  ]
    .filter(([, e]) => e.score <= RATED_DOWN_MAX_SCORE)
    .sort((a, b) => a[1].score * a[1].confidence - b[1].score * b[1].confidence)
    .slice(0, 5)
    .map(([key]) => key)
  if (ratedDown.length > 0) parts.push(`Has repeatedly rated down: ${ratedDown.join(', ')}.`)

  return parts.join(' ')
}

/**
 * "Rated down" thresholds. Scores are running averages of reaction levels
 * (loved +0.30, liked +0.15, disliked −0.20), so −0.10 needs at least ~71%
 * dislikes against likes, or 80% against loves. A genre the viewer rates
 * half up, half down averages around 0 and is not "rated down".
 */
export const RATED_DOWN_MAX_SCORE = -0.10
export const RATED_DOWN_MIN_SAMPLES = 3

/** The viewer text Jev is given: the profile, then what they avoid. */
export function jevState(dna: DNASchema): string {
  const avoids = avoidSummary(dna)
  return `VIEWER PROFILE:\n${profileSummary(dna)}${avoids ? `\n\nWHAT THIS VIEWER AVOIDS:\n${avoids}` : ''}`
}

// ─────────────────────────────────────────────
// The filter
// ─────────────────────────────────────────────

/** Jev's "would dislike" probability at or above this drops the candidate.
 *
 *  0.8 since 2026-11-07, from real ratings: Jev was asked step 4's exact
 *  question about 193 titles Eran, Shahar and Alon had rated but never
 *  rated in the app. At 0.7 it would drop 45 of 84 loved titles to catch
 *  31 of 41 disliked; at 0.8, 24 loved for 23 disliked; at 0.9, 4 loved
 *  for 11 disliked. 0.8 is a first step; see docs/INTEGRATION.md.
 *
 *  The first value, 0.7, came from `scripts/jev-threshold-probe.mts` (one
 *  made-up viewer, 8 titles, two runs on 2026-11-05): fits 0.04–0.13,
 *  avoided 0.70–0.97. */
export const JEV_DISLIKE_THRESHOLD = 0.8

/**
 * Removes the items Jev is sure the viewer would dislike; order is untouched
 * and an unanswered item is kept. If that would drop more than half the
 * batch the pass is distrusted and nothing is dropped — the SQL pass already
 * applied the hard rules, so a batch that is mostly "dislikes" means the
 * question misfired, not the catalog.
 */
export function dropDisliked<T>(
  items: T[],
  answers: Record<string, number>,
  keyOf: (item: T) => string,
  threshold = JEV_DISLIKE_THRESHOLD,
): T[] {
  const kept = items.filter(item => (answers[keyOf(item)] ?? 0) < threshold)
  // Strictly more than half: dropping exactly 25 of 50 still goes ahead.
  return kept.length * 2 < items.length ? items : kept
}

// ─────────────────────────────────────────────
// Main function
// ─────────────────────────────────────────────

export async function llmRerank(
  scored: ScoredTitle[],
  dna: DNASchema
): Promise<ScoredTitle[]> {
  const top50 = scored.slice(0, 50)
  if (top50.length === 0) return []
  const done = (items: ScoredTitle[]) => items.map(item => ({ ...item, groq_rationale: '' }))

  // The composite key: a bare tmdb_id would collide for a movie/TV pair
  // sharing an id.
  const keyOf = (s: ScoredTitle) => `${s.title.type}:${s.title.tmdb_id}`
  const describe = (s: ScoredTitle) => {
    const t = s.title
    const director = t.crew.directors[0]?.name ?? 'unknown director'
    const genres   = t.genres.map(g => g.name).join(', ')
    const tones    = t.tone_tags.join(', ') || 'unknown'
    return `"${t.title}" (${t.type}, ${t.release_year ?? '?'}) — Dir: ${director} — Genres: ${genres} — Tone: ${tones}`
  }

  const state = jevState(dna)
  const questions = Object.fromEntries(
    top50.map(s => [
      keyOf(s),
      `Would this viewer dislike ${describe(s)}? True if it is something they avoid or have rated down; false if it fits their taste.`,
    ]),
  )

  // GRACEFUL DEGRADATION: a Jev failure must never kill the pipeline.
  // Composite scoring (step 2) already produced the order — this pass only
  // removes. On any error, serve the batch as it came and log the failure.
  // Only the Jev call is inside the try: a bug in our own filtering must not
  // be reported to the devs as an API failure.
  let answers: Record<string, number>
  try {
    answers = await jevNoul(state, questions)
  } catch (err) {
    console.warn('[rerank] jev failed — composite order, nothing dropped:', err instanceof Error ? err.message : err)
    // Only an API failure is news for the devs (it usually means the token
    // needs a top-up); a machine without the key is a local setup gap.
    // Logged after the response is sent, so no user waits on Redis for it;
    // outside a request (tests, scripts) `after` throws and we write inline.
    if (!(err instanceof JevNotConfigured)) {
      const log = () => recordJevFailure('rerank', err)
      try {
        after(log)
      } catch {
        await log()
      }
    }
    return done(top50)
  }

  const kept = dropDisliked(top50, answers, keyOf)
  console.log(`[rerank] jev answered ${Object.keys(answers).length}/${top50.length}, dropped ${top50.length - kept.length}`)
  return done(kept)
}
