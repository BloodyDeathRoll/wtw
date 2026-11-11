/**
 * Turns a title's raw facts and AI scores into its taste scales (−1..1), with
 * frozen constants from the 980 game titles (norms.json), so a catalogue
 * title lands where it would have landed in the season's own set.
 *
 * norms.json is written once by scripts/derive-scale-norms.mts and then
 * frozen: re-deriving it moves every catalogue title, so it goes with a bump
 * of TASTE_FEATURE_VERSION (features.ts). docs/plan/PLAN.md, P1-D1.
 */
import type { GameGenre } from '@/app/play/lib/genres'
import type { AIScale, TasteScale } from '@/app/play/lib/scales'

import NORMS from './norms.json'

/** Scales the AI judges in the catalogue: the season's seven plus `audience`. */
export type CatalogueAIScale = AIScale | 'audience'

export interface ScaleNorms {
  /** Mean and population sd of the raw −5..5 scores over the 980 set's carriers; null until scored (audience before P1-D2). */
  ai: Record<CatalogueAIScale, { mean: number; sd: number } | null>
  /** The 980 set's release years, sorted ascending. */
  years: number[]
  /** The 980 set's TMDB vote counts per type, sorted ascending. */
  votes: Record<'movie' | 'tv', number[]>
  /** The 980 set's series episode counts (known ones only), sorted ascending. */
  episodes: number[]
}

export interface ScaleInput {
  type: 'movie' | 'tv'
  release_year: number | null
  tmdb_vote_count: number | null
  /** Series only; null when unknown. */
  episodes: number | null
  game_genres: GameGenre[]
  /** The AI's −5..5 scores; null or missing = not scored. */
  raw: Partial<Record<CatalogueAIScale, number | null>>
}

const clamp = (x: number) => Math.max(-1, Math.min(1, x))
const round2 = (x: number) => Math.round(x * 100) / 100

/** spread() in src/app/play/lib/scales.ts, with the population's mean and sd frozen. */
export function spreadOne(raw: number, mean: number, sd: number): number {
  if (sd === 0) return 0
  return round2(clamp((raw - mean) / (1.5 * sd)))
}

/**
 * rankSpread() in src/app/play/lib/scales.ts for a value that need not be in
 * the set: ties share their average rank, values between two set values get
 * a linearly interpolated rank, values outside the set's range clamp to ±1.
 * `sorted` is ascending.
 */
export function rankAgainst(sorted: number[], x: number): number {
  const n = sorted.length
  if (n === 0) return 0
  if (n === 1) return x < sorted[0] ? -1 : x > sorted[0] ? 1 : 0
  if (x < sorted[0]) return -1
  if (x > sorted[n - 1]) return 1
  const avgRank = (i: number) => {
    let lo = i, hi = i
    while (lo > 0 && sorted[lo - 1] === sorted[i]) lo--
    while (hi < n - 1 && sorted[hi + 1] === sorted[i]) hi++
    return (lo + hi) / 2
  }
  // First index whose value is ≥ x.
  let lo = 0, hi = n - 1
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < x) lo = mid + 1; else hi = mid }
  let rank: number
  if (sorted[lo] === x) rank = avgRank(lo)
  else {
    const below = lo - 1
    const r0 = avgRank(below), r1 = avgRank(lo)
    rank = r0 + ((x - sorted[below]) / (sorted[lo] - sorted[below])) * (r1 - r0)
  }
  return round2((rank / (n - 1)) * 2 - 1)
}

const logCache = new WeakMap<number[], number[]>()
/** log10 of a set's vote counts, once per array (the catalogue scorer calls this ~35k times). Floored at 1 vote: log10(0) would make the interpolation NaN. */
function logVotes(votes: number[]): number[] {
  let logs = logCache.get(votes)
  if (!logs) logCache.set(votes, logs = votes.map(v => Math.log10(Math.max(1, v))))
  return logs
}

const AI: CatalogueAIScale[] = ['tone', 'energy', 'pace', 'dark', 'complex', 'fantastic', 'humor', 'audience']

export function normaliseScales(t: ScaleInput, norms: ScaleNorms = NORMS as ScaleNorms): Partial<Record<TasteScale, number>> {
  const out: Partial<Record<TasteScale, number>> = {}
  for (const scale of AI) {
    const raw = t.raw[scale]
    const n = norms.ai[scale]
    if (raw == null || !n) continue
    if (scale === 'humor' && !t.game_genres.includes('comedy')) continue
    out[scale] = spreadOne(raw, n.mean, n.sd)
  }
  if (t.release_year != null) out.modern = rankAgainst(norms.years, t.release_year)
  // log10 so a title between two set values interpolates on the scale TMDB fame grows on; no votes sits below the set (+1).
  const votes = t.tmdb_vote_count ?? 0
  out.indie = votes > 0 ? -rankAgainst(logVotes(norms.votes[t.type]), Math.log10(votes)) : 1
  if (t.type === 'tv' && t.episodes) out.commit = rankAgainst(norms.episodes, t.episodes)
  return out
}
