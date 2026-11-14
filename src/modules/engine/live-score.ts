/**
 * The live score (docs/plan/PLAN.md §6, soft launch): the deck's metric on
 * real use. Per user, the concordance between the score a feed card had when
 * it was served (served_titles.last_score, migration 0032) and the reaction it
 * then got (recommendation_feedback). 50 is a coin flip. Pure; the weekly
 * script is scripts/live-score.mts.
 *
 * Scores are only compared within one formula: v1's composite and v2's Φ(z)
 * are different scales, and a feed served across the switch is two samples.
 */
import type { RecommendationResult } from '@/types/dna'
import type { ReasonPayloadWithTaste } from './types'

export type ServedFormula = 'v1' | 'v2' | 'cold'
export type Level = 'loved' | 'liked' | 'disliked'
const RANK: Record<Level, number> = { loved: 3, liked: 2, disliked: 1 }

/** Which formula a served card came from: v2 batches carry `taste` (step 6); a cold-start pick scores 0 (no claim). */
export function servedFormula(r: Pick<RecommendationResult, 'composite_score' | 'reason_payload'>): ServedFormula {
  if (!(r.composite_score > 0)) return 'cold'
  return (r.reason_payload as ReasonPayloadWithTaste | undefined)?.taste ? 'v2' : 'v1'
}

/**
 * Concordance (0–100) over pairs at different levels; ties in score count
 * half. `ldOnly`: loved-vs-disliked pairs only. NaN with no pairs. Same
 * definition as the harness (scripts/eval/metrics.ts), kept here so the app
 * module doesn't import from scripts/.
 */
export function concordance(items: { score: number; level: Level }[], ldOnly = false): number {
  let agree = 0, pairs = 0
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j]
      if (a.level === b.level) continue
      if (ldOnly && (a.level === 'liked' || b.level === 'liked')) continue
      const [hi, lo] = RANK[a.level] > RANK[b.level] ? [a, b] : [b, a]
      pairs++
      agree += hi.score > lo.score ? 1 : hi.score === lo.score ? 0.5 : 0
    }
  }
  return pairs ? (100 * agree) / pairs : NaN
}

export interface ServedRow { key: string; score: number | null; formula: string | null; first_served_at: string }
export interface ReactionRow { key: string; level: Level; at: string }

export interface UserLiveScore {
  formula: Exclude<ServedFormula, 'cold'>
  n: number
  loved: number
  liked: number
  disliked: number
  concordance: number
  ld: number
}

/**
 * One user's live score per formula. A reaction counts when the card had a
 * score and had been served before the reaction (a title rated elsewhere
 * first, then served, says nothing about the ranking). The latest reaction per
 * title wins. Cold-start cards are left out: their score is 0 by design.
 */
export function userLiveScores(served: ServedRow[], reactions: ReactionRow[], minRated = 10): UserLiveScore[] {
  const latest = new Map<string, ReactionRow>()
  for (const r of reactions) {
    const prev = latest.get(r.key)
    if (!prev || r.at > prev.at) latest.set(r.key, r)
  }
  const byFormula = new Map<'v1' | 'v2', { score: number; level: Level }[]>()
  for (const s of served) {
    if (s.score == null || (s.formula !== 'v1' && s.formula !== 'v2')) continue
    const r = latest.get(s.key)
    if (!r || r.at < s.first_served_at) continue
    const list = byFormula.get(s.formula) ?? []
    list.push({ score: s.score, level: r.level })
    byFormula.set(s.formula, list)
  }
  const out: UserLiveScore[] = []
  for (const [formula, items] of byFormula) {
    if (items.length < minRated) continue
    const c = (l: Level) => items.filter(x => x.level === l).length
    out.push({
      formula, n: items.length, loved: c('loved'), liked: c('liked'), disliked: c('disliked'),
      concordance: concordance(items), ld: concordance(items, true),
    })
  }
  return out.sort((a, b) => a.formula.localeCompare(b.formula))
}

export interface ServedShares {
  formula: Exclude<ServedFormula, 'cold'>
  /** Scored cards of this formula first served in the window. */
  served: number
  loved: number
  liked: number
  disliked: number
  /**
   * Served, never rated. The feed records no skip (people scroll past), so
   * this is everything else: a title not wanted, a forgotten dislike, or a
   * card the user never scrolled down to. Read it as an upper bound.
   */
  unknown: number
}

/**
 * Shares of everything served (Shahar, #240, 2026-11-14): the concordance
 * above only sees rated cards, so it can't tell a feed people rate from a feed
 * they scroll past. Per formula, the scored cards first served since `since`,
 * split by the reaction they got after being served (the latest one), else
 * `unknown`. Cold-start and unscored cards are left out, as above.
 */
export function servedShares(served: ServedRow[], reactions: ReactionRow[], since: string): ServedShares[] {
  const latest = new Map<string, ReactionRow>()
  for (const r of reactions) {
    const prev = latest.get(r.key)
    if (!prev || r.at > prev.at) latest.set(r.key, r)
  }
  const from = Date.parse(since)
  const by = new Map<'v1' | 'v2', ServedShares>()
  for (const s of served) {
    if (s.score == null || (s.formula !== 'v1' && s.formula !== 'v2')) continue
    if (Date.parse(s.first_served_at) < from) continue
    const row = by.get(s.formula) ?? { formula: s.formula, served: 0, loved: 0, liked: 0, disliked: 0, unknown: 0 }
    row.served++
    const r = latest.get(s.key)
    if (r && Date.parse(r.at) >= Date.parse(s.first_served_at)) row[r.level]++
    else row.unknown++
    by.set(s.formula, row)
  }
  return [...by.values()].sort((a, b) => a.formula.localeCompare(b.formula))
}
