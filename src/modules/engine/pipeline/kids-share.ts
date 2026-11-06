/**
 * How many kids' titles a batch may hold, for every user (2026-11-06).
 *
 * Why: the scorer has no idea of "made for kids". For a viewer whose taste
 * reads warm, hopeful and funny, kids' films are simply the warmest, most
 * hopeful titles in the catalog, so they win on mood and story match and
 * nothing holds them back. Measured on a real account: 1 in 10 picks before,
 * then half of every batch (24 of 48) after one loved Zootopia and a run of
 * rejected horror. Nothing in the code had changed; the old code gave the
 * same batch on that taste data.
 *
 * The rule: kids' titles get a small share by default, and the share grows
 * only with what the viewer has actually shown —
 *   - every kids' title they loved or liked raises it, every one they
 *     disliked lowers it (read from genre_affinity "family" / "kids", which
 *     every rating already updates);
 *   - the "Family & kids" genre on the games' entry screen counts too: Love
 *     and Like arrive in the same genre_affinity entry, and Never is an
 *     exclusion rule that removes them before scoring;
 *   - asking for it in the session ("something for the kids") lifts the
 *     limit for that batch.
 *
 * Applied to the ranked list before the batch is cut, so the slots a
 * kids' title can't have go to the next best title of any other kind.
 */

import type { DNASchema, SessionContext, ContentAffinityEntry } from '@/types/dna'
import type { ScoredTitle } from '../types'

/** TMDB genres that mean "made for children and families": Family on movies and series, Kids on series. */
const KIDS_GENRES = new Set(['family', 'kids'])

/** Kids' titles in a 50-title batch for a viewer who has shown nothing either way. */
export const KIDS_BASE = 3
/**
 * Slots one "always loved" sample adds (a liked one adds half; a disliked
 * one takes about two away). One loved kids' film → 6 of 50; five → 18.
 */
export const KIDS_PER_SAMPLE = 3
/** genre_affinity's "always loved" level (lib/reaction-score.ts). */
const LOVED_LEVEL = 0.30

/** A session request that is about kids or family viewing. */
const KIDS_REQUEST = /\b(kids?|child(ren)?|family|families|cartoons?|animated|animation|pixar|disney)\b/i

export function isKidsTitle(t: { genres: { name: string }[] | null }): boolean {
  return (t.genres ?? []).some(g => KIDS_GENRES.has(g.name.trim().toLowerCase()))
}

function allowanceFrom(e: ContentAffinityEntry): number {
  return KIDS_BASE + KIDS_PER_SAMPLE * e.sample_size * (e.score / LOVED_LEVEL)
}

/** How many kids' titles this viewer's batch may hold, out of `size`. */
export function kidsAllowance(dna: DNASchema, size: number, sessionContext?: SessionContext): number {
  if (sessionContext?.immediate_request && KIDS_REQUEST.test(sessionContext.immediate_request)) return size
  const g = dna.strand_c_visceral_specs?.genre_affinity ?? {}
  // Whichever of Family / Kids the viewer has shown more for; a missing one
  // says nothing (it must not pull three disliked Family films back to the default).
  const shown = [g['family'], g['kids']].filter((e): e is ContentAffinityEntry => !!e && e.sample_size > 0)
  const n = shown.length ? Math.max(...shown.map(allowanceFrom)) : KIDS_BASE
  return Math.max(0, Math.min(size, Math.round(n)))
}

/**
 * The batch with its kids' titles held to the allowance: the best-matching
 * ones stay, the rest give their slots to the best titles of any other kind
 * from `pool` (the ranked list the batch was cut from). Applied AFTER the
 * batch is composed, so the fresh / previously-served split can't drop the
 * kids' titles that were allowed and leave none at all.
 */
export function capKidsShare<T extends ScoredTitle>(
  batch: T[],
  pool: T[],
  dna: DNASchema,
  sessionContext?: SessionContext,
): T[] {
  const allowance = kidsAllowance(dna, batch.length, sessionContext)
  const kids = batch.filter(s => isKidsTitle(s.title))
  if (kids.length <= allowance) return batch

  const byScore = (a: T, b: T) => b.composite_score - a.composite_score
  const drop = new Set(kids.sort(byScore).slice(allowance))
  const inBatch = new Set(batch)
  const fill = pool
    .filter(s => !inBatch.has(s) && !isKidsTitle(s.title))
    // Fresh first, as composeBatch prefers; then by match.
    .sort((a, b) => Number(!!a.title.previously_served) - Number(!!b.title.previously_served) || byScore(a, b))
    .slice(0, drop.size)
  return [...batch.filter(s => !drop.has(s)), ...fill].sort(byScore)
}
