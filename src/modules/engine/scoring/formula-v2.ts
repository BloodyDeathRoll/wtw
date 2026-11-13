/**
 * Formula v2 (docs/plan/PLAN.md DEC-1, P1-E3). Pure.
 *
 *   s = 0.30·z(creators) + 0.20·z(crowd) + 0.50·z(taste model)
 *   composite = Φ(s / sd(s))
 *
 * Each part is z-scored within the candidate pool (population sd; a part
 * that doesn't vary gives everyone 0). Φ keeps the composite in (0,1), so
 * step 3's multipliers, step 5's `< 0.4`, co-watch's sqrt(a·b) and the
 * match % keep working, and it reads as "better than X% of this pool".
 *
 * Story match (narrative), pace & tone (visceral), genre habits (content)
 * and recency get weight 0: three of them tested no better than a coin flip.
 */

export const V2_WEIGHTS = { creators: 0.30, crowd: 0.20, model: 0.50 } as const

/** Below this a spread is rounding noise, not variation. */
const FLAT = 1e-12

function mean(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length
}

/** Population standard deviation. */
function popSd(xs: number[], m = mean(xs)): number {
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length)
}

/** z-scores within the list, population sd. A flat (or empty) list → all 0. */
export function zScores(xs: number[]): number[] {
  if (xs.length === 0) return []
  const m = mean(xs)
  const sd = popSd(xs, m)
  return sd < FLAT ? xs.map(() => 0) : xs.map(x => (x - m) / sd)
}

/**
 * Standard normal CDF, Φ(x). erf by Abramowitz & Stegun 7.1.26 (absolute
 * error < 1.5e-7), plenty for a ranking and a match %.
 */
export function normalCdf(x: number): number {
  // The approximation gives erf(0) ≈ 1e-9; an average title is exactly 0.5.
  if (x === 0) return 0.5
  const z = Math.abs(x) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * z)
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))))
  const erf = 1 - poly * Math.exp(-z * z)
  return x >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf)
}

export interface V2Parts {
  /** Crew + lineage, as v1 computes it (0–1). */
  creators: number
  /** externalRatingScore (0–1). */
  crowd: number
  /** w·taste_vec, or null when the title has no taste vector yet. */
  model: number | null
}

export interface V2Score {
  z_creators: number
  z_crowd: number
  /** 0 for a title with no taste vector: it sits at the pool mean. */
  z_model: number
  /** w·taste_vec, null when the title has no vector. */
  model_score: number | null
  /** The weighted sum before Φ. */
  s: number
  /** Φ(s / sd(s)), in (0,1). 0.5 when nothing in the pool differs. */
  composite: number
  /** How many titles the z-scores were taken over. A pool of a few says little (P1-E5's bars need ≥ BARS_MIN_POOL). */
  pool_size: number
  /** The title's taste vector, when it has one (the "What it's like" lines, P1-E5). Set by step 2. */
  vec?: number[]
  /** w_k·x_k per input, when it has a vector (the Why facts, P1-E5). Set by step 2. */
  contributions?: number[]
  /** Game genres the viewer has rated down themselves; only these may be a genre catch (#279 (c)). Set by step 2. */
  rated_down_genres?: import('@/app/play/lib/genres').GameGenre[]
}

/** Scores a whole pool at once: every z is relative to the others. */
export function scoreFormulaV2(parts: V2Parts[]): V2Score[] {
  if (parts.length === 0) return []

  // A title with no vector takes the pool mean, so its z is exactly 0.
  const known = parts.map(p => p.model).filter((m): m is number => m != null)
  const fill = known.length > 0 ? mean(known) : 0
  const zm = zScores(parts.map(p => p.model ?? fill))
  // Exact 0 for the filled ones, not a float near it.
  parts.forEach((p, i) => { if (p.model == null) zm[i] = 0 })

  const zc = zScores(parts.map(p => p.creators))
  const zw = zScores(parts.map(p => p.crowd))

  const s = parts.map((_, i) => V2_WEIGHTS.creators * zc[i] + V2_WEIGHTS.crowd * zw[i] + V2_WEIGHTS.model * zm[i])
  const sdS = popSd(s)

  return parts.map((p, i) => ({
    z_creators: zc[i],
    z_crowd: zw[i],
    z_model: zm[i],
    model_score: p.model,
    s: s[i],
    composite: sdS < FLAT ? 0.5 : normalCdf(s[i] / sdS),
    pool_size: parts.length,
  }))
}
