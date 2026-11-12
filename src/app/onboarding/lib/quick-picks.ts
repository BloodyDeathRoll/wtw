/**
 * P2-U4 · The quick picks ("this or that") of the new onboarding: the rules, without the screen.
 * Signed off by Eran in P2-U0 (docs/plan/PLAN.md → P2-U0, part 5, and P2-U4):
 *
 *   - Ends at **12 picks or 18 pairs**, whichever comes first. A pick is a tap on a poster; a pair counts toward the
 *     18 once it's answered (a pick, or "Can't decide"). Swaps inside a pair count toward neither.
 *   - **"Can't decide"** brings a new pair. It's not a pick; it counts toward the 18.
 *   - **"Haven't seen": two swaps per side.** Each swaps that title for a similar one (the season's `replaceSide`);
 *     after the second, that side's button is off. If no similar title is left, the side goes off early.
 *   - **No plot pair:** the season's "Which sounds better tonight?" mode never fires here.
 *   - Pairs come from the season's picker (`nextPair`) — the picker the measured gain came from — run on a fresh
 *     state seeded with the genre answers. The user's season state is never touched.
 *
 * Pure: every function takes the state and returns what to record. The screen (and saving) is built on top.
 */
import { freshState, nextPair, choose, replaceSide, pairKey, type PlayState, type Pair, type Title } from '@/app/play/lib/brain'
import { GAME_GENRES, type GameGenre } from '@/app/play/lib/genres'
import type { PlayEvent } from '@/app/play/lib/events'

export const QUICK_PICKS = 12
export const MAX_PAIRS = 18
export const SWAPS_PER_SIDE = 2

export type GenreAnswer = 'love' | 'like' | 'never'
export type Side = 'a' | 'b'
/** The gold line under the question after a swap (the signed-off wording lives in the screen). */
export type SwapNote = 'swapped' | 'last-swap' | 'no-swaps' | null

export interface QuickPicks {
  /** A fresh brain state, seeded with the genre answers: what the picker reads. Not the season's. */
  S: PlayState
  pair: Pair | null
  picks: number
  pairs: number
  swaps: Record<Side, number>
  off: Record<Side, boolean>
  note: SwapNote
  done: boolean
}

/** The same values the genre step writes in the season: Love 2, Like 1, Never −9, no answer 0. */
const VALUE: Record<GenreAnswer, number> = { love: 2, like: 1, never: -9 }

export function seedState(answers: Partial<Record<GameGenre, GenreAnswer>>): PlayState {
  const S = freshState()
  for (const g of GAME_GENRES) { const a = answers[g.id]; if (a) S.gen[g.id] = VALUE[a] }
  const loves = GAME_GENRES.filter(g => S.gen[g.id] >= 1).map(g => g.id)
  S.sel = loves.length ? loves : null
  S.loved = GAME_GENRES.filter(g => S.gen[g.id] >= 2).map(g => g.id)
  return S
}

function draw(q: QuickPicks, T: Title[], rand: () => number): QuickPicks {
  const p = nextPair(q.S, T, {}, rand)
  if (!p) return { ...q, pair: null, done: true }   // nothing left to ask: end early rather than repeat
  p.pitch = false
  p.unseenCount = 0
  return { ...q, pair: p, swaps: { a: 0, b: 0 }, off: { a: false, b: false }, note: null }
}

const over = (q: QuickPicks) => q.picks >= QUICK_PICKS || q.pairs >= MAX_PAIRS

export function startQuickPicks(answers: Partial<Record<GameGenre, GenreAnswer>>, T: Title[], rand = Math.random): QuickPicks {
  const q: QuickPicks = { S: seedState(answers), pair: null, picks: 0, pairs: 0, swaps: { a: 0, b: 0 }, off: { a: false, b: false }, note: null, done: false }
  return draw(q, T, rand)
}

/** A tap on a poster: the one signal the taste model learns from (a `duel` event with `chosen`). */
export function pick(q: QuickPicks, side: Side, T: Title[], rand = Math.random): { q: QuickPicks; event: PlayEvent } {
  if (!q.pair || q.done) throw new Error('No pair to pick from')
  const p = q.pair
  const event: PlayEvent = {
    kind: 'duel', item_key: pairKey(p.a, p.b),
    payload: { a: p.a.id, b: p.b.id, axis: p.axis, pitch: false, chosen: p[side].id, source: 'onboarding' },
  }
  choose(q.S, p, side)
  const next = { ...q, picks: q.picks + 1, pairs: q.pairs + 1 }
  return { q: over(next) ? { ...next, pair: null, done: true } : draw(next, T, rand), event }
}

/** "Can't decide": a new pair; counts toward the 18 pairs, not the 12 picks. The taste model ignores it. */
export function cantDecide(q: QuickPicks, T: Title[], rand = Math.random): { q: QuickPicks; event: PlayEvent } {
  if (!q.pair || q.done) throw new Error('No pair to skip')
  const p = q.pair
  const event: PlayEvent = { kind: 'cant_decide', item_key: pairKey(p.a, p.b), payload: { a: p.a.id, b: p.b.id, source: 'onboarding' } }
  const next = { ...q, pairs: q.pairs + 1 }
  return { q: over(next) ? { ...next, pair: null, done: true } : draw(next, T, rand), event }
}

/** "Haven't seen" on one side: swap it for a similar title, at most twice per side. Ignored once the side is off. */
export function haventSeen(q: QuickPicks, side: Side, T: Title[]): { q: QuickPicks; event: PlayEvent | null } {
  if (!q.pair || q.done || q.off[side]) return { q, event: null }
  const p = { ...q.pair }
  const gone = p[side]
  p.unseenCount = 0            // keeps replaceSide from ever switching to the plot pair
  replaceSide(q.S, T, p, side)
  const event: PlayEvent = { kind: 'unseen', item_key: gone.id, payload: { title: gone.id, source: 'onboarding' } }
  const swaps = { ...q.swaps, [side]: q.swaps[side] + 1 }
  const noneLeft = p.pitch     // replaceSide found no similar title: the side stays as it was
  p.pitch = false
  p.unseenCount = 0
  const off = { ...q.off, [side]: noneLeft || swaps[side] >= SWAPS_PER_SIDE }
  const note: SwapNote = off.a && off.b ? 'no-swaps' : noneLeft ? null : swaps[side] === 1 ? 'swapped' : 'last-swap'
  return { q: { ...q, pair: p, swaps, off, note }, event }
}
