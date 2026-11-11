/**
 * The deck's scores (docs/plan/EVIDENCE.md §M), pure so they are unit-tested.
 *
 *   concordance — over every pair of titles rated at different levels, the
 *                 share where the preferred one scores higher; ties count
 *                 half. 50 = a coin flip. Returned as 0–100.
 *   L/D         — the same over loved-vs-disliked pairs only.
 *   top-k share — of the k best-scored titles, the share loved / disliked.
 */

export type Level = 'loved' | 'liked' | 'disliked'
export const LEVEL_RANK: Record<Level, number> = { loved: 3, liked: 2, disliked: 1 }

export interface Scored { score: number; level: Level }

/** Concordance (0–100) over pairs at different levels; `ldOnly` keeps loved-vs-disliked pairs. NaN with no pairs. */
export function concordance(items: Scored[], ldOnly = false): number {
  let agree = 0, pairs = 0
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j]
      const ra = LEVEL_RANK[a.level], rb = LEVEL_RANK[b.level]
      if (ra === rb) continue
      if (ldOnly && ra + rb !== 4) continue
      pairs++
      const [hi, lo] = ra > rb ? [a, b] : [b, a]
      agree += hi.score > lo.score ? 1 : hi.score === lo.score ? 0.5 : 0
    }
  }
  return pairs ? (100 * agree) / pairs : NaN
}

/** Of the k best-scored, the share (0–100) loved and disliked. A tie at the cut keeps the earlier item (stable sort). */
export function topShare(items: Scored[], k = 5): { loved: number; disliked: number } {
  const top = [...items].sort((a, b) => b.score - a.score).slice(0, k)
  const share = (l: Level) => (top.length ? (100 * top.filter(t => t.level === l).length) / top.length : NaN)
  return { loved: share('loved'), disliked: share('disliked') }
}

/** Population z-scores; all zero when the values don't vary (sd = 0). */
export function zScores(xs: number[]): number[] {
  if (xs.length === 0) return []
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length
  const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length)
  return sd === 0 ? xs.map(() => 0) : xs.map(x => (x - mean) / sd)
}

/** Formula v2 (PLAN P1-E3): 0.30·z(creators) + 0.20·z(crowd) + 0.50·z(model), z within the set. */
export function formulaV2(creators: number[], crowd: number[], model: number[]): number[] {
  const zc = zScores(creators), zw = zScores(crowd), zm = zScores(model)
  return zc.map((c, i) => 0.3 * c + 0.2 * zw[i] + 0.5 * zm[i])
}

/** Seeded PRNG (mulberry32), so a run with the same --seed draws the same samples. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function shuffle<T>(xs: T[], rand: () => number): T[] {
  const out = [...xs]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}
