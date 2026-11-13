/**
 * The taste model: a per-person ridge regression over the 25 taste features
 * (src/lib/taste-scales/features.ts), trained on the person's ratings and
 * this-or-that picks. Pure — the loader is load-taste-training.ts.
 *
 * Recipe (docs/plan/EVIDENCE.md §R, PLAN P1-D4): ratings are levels 3/2/1
 * centred on their weighted mean; a pick is x_chosen − x_other with target
 * 1; ridge with no intercept, penalty 0.5 on the rating input and 4.0 on
 * the other 24. Solved in closed form on 25×25, so it reruns on every rating.
 *
 * No intercept: predict() is relative to the person's own average (0 = an
 * average title for them), not a 1–3 rating. Formula v2 z-scores it within
 * the candidates anyway.
 *
 * Genre lean (P1-D4b, DEC-13): the ridge pulls towards w0, not towards 0.
 * w0 is the genre screen's Love / Like, so a new person's feed leans to what
 * they said and their ratings and picks take over as they come in.
 */
import type { DNASignal, Reaction } from '@/types/dna'
// brain.ts is pure and must stay so: this file runs in the engine (update-from-play.ts and cold-start.ts import it too).
import { nevers, type PlayState } from '@/app/play/lib/brain'
import { FEATURE_GENRES, TASTE_FEATURE_COUNT } from '@/lib/taste-scales/features'
import { titleKey } from '@/lib/title-key'

export interface TasteRow { vec: number[]; level: 1 | 2 | 3; weight: number }
export interface TastePair { chosen: number[]; other: number[] }

const LEVEL: Record<Reaction, 1 | 2 | 3> = { loved: 3, liked: 2, disliked: 1 }
const PENALTY = [0.5, ...new Array(TASTE_FEATURE_COUNT - 1).fill(4.0)]
/** CLAUDE.md temporal decay: a rating older than 18 months counts half (same threshold as apply-temporal-decay.ts). */
const DECAY_AFTER_MS = 18 * 30 * 24 * 60 * 60 * 1000

/**
 * How far a Love pulls its genre input; a Like pulls half. Set with the eval
 * harness (--lean): the largest value that costs no more than 1 concordance
 * point against no lean on the three test sheets (numbers in PR for #278).
 */
export const GENRE_LEAN = 1

/**
 * w0 from the genre answers: Love → g, Like → g/2 on that genre's input, 0
 * everywhere else. Never is a rule, not a lean, so it stays 0. Read as
 * playGenresOf (cold-start.ts) reads them: `loved` and `sel` are what the
 * person said; `gen` drifts with every pick and only tells the Nevers.
 * The 16 chips are already folded onto the 13 there (to13, genre-step.ts).
 */
export function genreLean(state: Pick<PlayState, 'sel' | 'loved' | 'gen'> | null | undefined, g = GENRE_LEAN): number[] {
  const w0 = new Array<number>(TASTE_FEATURE_COUNT).fill(0)
  if (!state) return w0
  // A save with no `sel` (the genre step not done) has no Likes: no answer, no lean.
  const loved = new Set(state.loved ?? []), liked = new Set(state.sel ?? [])
  const never = new Set(state.gen ? nevers(state) : [])
  FEATURE_GENRES.forEach((id, k) => {
    if (never.has(id)) return
    if (loved.has(id)) w0[1 + k] = g
    else if (liked.has(id)) w0[1 + k] = g / 2
  })
  return w0
}

/** Solves (XᵀWX + Λ) w = XᵀWy + Λ·w0. Without `w0` it is the plain ridge towards 0. */
export function trainTasteModel(rows: TasteRow[], pairs: TastePair[], w0?: number[]): number[] {
  const d = TASTE_FEATURE_COUNT
  const A = Array.from({ length: d }, (_, i) => Array.from({ length: d }, (_, j) => (i === j ? PENALTY[i] : 0)))
  const b = Array.from({ length: d }, (_, i) => PENALTY[i] * (w0?.[i] ?? 0))
  const add = (x: number[], y: number, w: number) => {
    for (let i = 0; i < d; i++) {
      if (x[i] === 0) continue // a zero input adds nothing to row i of A or to b[i]; genres are mostly zero
      b[i] += w * x[i] * y
      for (let j = 0; j < d; j++) A[i][j] += w * x[i] * x[j]
    }
  }
  const totalW = rows.reduce((s, r) => s + r.weight, 0)
  const mean = totalW > 0 ? rows.reduce((s, r) => s + r.weight * r.level, 0) / totalW : 0
  for (const r of rows) add(r.vec, r.level - mean, r.weight)
  for (const p of pairs) add(p.chosen.map((v, k) => v - p.other[k]), 1, 1)
  if (rows.length === 0 && pairs.length === 0) return Array.from({ length: d }, (_, i) => w0?.[i] ?? 0)
  return solveSPD(A, b)
}

export function predict(w: number[], x: number[]): number {
  let s = 0
  for (let k = 0; k < w.length; k++) s += w[k] * x[k]
  return s
}

/** w_k·x_k per input, for the "Why this?" lines (P1-E5). */
export function contributions(w: number[], x: number[]): number[] {
  return w.map((wk, k) => wk * x[k])
}

/**
 * A this-or-that answer: two title keys (`movie:603`) and the one picked.
 * Only `duel` events count (season duels and onboarding picks), as PLAN
 * P1-D4 specifies; knockout, showdown and mind reader also record a
 * `chosen` but are played under their own rules, so they are left out.
 * A pair played twice counts twice: a repeated choice is stronger evidence.
 */
export interface DuelPick { a: string; b: string; chosen: string }

/**
 * Rows and pairs from the person's signals and picks, given the vectors that
 * exist (by title key). Titles named in chat (`session_*` sources) are left
 * out (DEC-5); titles without a vector are skipped. A missing `watched_at`
 * counts as recent. `holdOut` (title keys, evaluation only) drops the picks
 * that touch those titles.
 */
export function buildTraining(signals: DNASignal[], picks: DuelPick[], vecs: Map<string, number[]>, now = Date.now(), holdOut?: Set<string>) {
  const rows: TasteRow[] = []
  for (const s of signals) {
    if (s.source.startsWith('session_')) continue
    // 'mixed' was dropped in migration 0013 but old signals may still carry it; its level would be NaN.
    const level = LEVEL[s.reaction]
    if (!level) continue
    const vec = vecs.get(titleKey(s.type, s.tmdb_id))
    if (!vec) continue
    const old = s.watched_at != null && now - new Date(s.watched_at).getTime() > DECAY_AFTER_MS
    rows.push({ vec, level, weight: old ? 0.5 : 1 })
  }
  const pairs: TastePair[] = []
  for (const p of picks) {
    if (p.a === p.b) continue
    if (holdOut?.has(p.a) || holdOut?.has(p.b)) continue
    const other = p.chosen === p.a ? p.b : p.chosen === p.b ? p.a : null
    const chosen = vecs.get(p.chosen)
    const otherVec = other ? vecs.get(other) : undefined
    if (chosen && otherVec) pairs.push({ chosen, other: otherVec })
  }
  return { rows, pairs }
}

/** Cholesky solve of A·x = b for symmetric positive-definite A (the ridge penalty guarantees it). */
function solveSPD(A: number[][], b: number[]): number[] {
  const n = b.length
  const L = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i][j]
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k]
      L[i][j] = i === j ? Math.sqrt(s) : s / L[j][j]
    }
  }
  const y = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    let s = b[i]
    for (let k = 0; k < i; k++) s -= L[i][k] * y[k]
    y[i] = s / L[i][i]
  }
  const x = new Array<number>(n)
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i]
    for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k]
    x[i] = s / L[i][i]
  }
  return x
}
