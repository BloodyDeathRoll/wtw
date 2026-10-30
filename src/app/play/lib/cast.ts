/**
 * Cast Call (Eran, 2026-10-27; prototype docs/prototypes/credit-check/, rules
 * in docs/taste-games-handoff.md "In progress: Cast Call").
 *
 * A face and nine posters: "Select 4 titles with …". Seven faces a round (Eran, 2026-10-30: ten was out of reach) against
 * a 60-second clock; each right poster +1, each wrong one −1, all four right
 * wins 3 seconds. Built by scripts/build-cast-call.mts from the live
 * catalogue: every wrong poster is a title the actor has no credit on at all.
 *
 * Repeats (Eran): none in the first 5 rounds; after that a face may come back
 * once it was last seen 3+ rounds ago, at most 2 returning faces a round while
 * fresh ones are left, each time with its next grid (new posters).
 */
import type { PlayState } from './brain'
import type { GameGenre } from './genres'

export interface CastTitle { k: string; t: string; y: number; p: string; n?: GameGenre[]; f?: string }
/** A grid cell: an index into `titles`, and the character they played (null = a wrong poster). */
export type CastCell = [number, string | null]
export type CastTier = 'easy' | 'medium' | 'hard'
export interface CastFace { id: number; name: string; img: string; tier: CastTier; w?: 1; grids: CastCell[][] }
export interface CastData { built: string; titles: CastTitle[]; faces: CastFace[] }
/** A face as dealt into a round: one of its grids, resolved. */
export interface CastDeal { face: CastFace; grid: number; cells: { title: CastTitle; role: string | null }[] }
/** Round history: rounds started, and per face (Line-up: per poster) [last round seen, times seen]. */
/** `v`: the scoring rules the best score was made under (2 = 7 faces + bonuses, 2026-10-30). */
export interface CastHistory { runs: number; seen: Record<string, [number, number]>; v?: number }

/** Fired by the game top bar when "How to play" opens or closes (detail: open); Cast Call pauses its clock. */
export const RULES_EVENT = 'wtw-game-rules'

export const CAST_FACES = 7, CAST_PICKS = 4, CAST_TIME = 60_000, CAST_BONUS = 3_000, CAST_LOW = 10_000
/** Bonuses (Eran, 2026-10-30): a perfect grid is worth 2 more points (and 3 seconds); finishing all seven
 * with 21+ of the 28 right turns every 2 seconds left into a point (random tapping gets ~12 right). */
export const CAST_PERFECT_POINTS = 2, CAST_TIME_MIN_RIGHT = 21, CAST_TIME_PER_POINT = 2_000
const RULES_V = 2
const FRESH_RUNS = 5, GAP = 3, MAX_BACK = 2
/** Easy → hard inside a round. */
const ORDER: CastTier[] = ['easy', 'easy', 'medium', 'medium', 'hard', 'hard', 'hard']
const NEAR: Record<CastTier, CastTier[]> = { easy: ['easy', 'medium', 'hard'], medium: ['medium', 'easy', 'hard'], hard: ['hard', 'medium', 'easy'] }

const history = (S: PlayState): CastHistory => (S.cast ??= { runs: 0, seen: {} })

/** The face's next grid with nothing from a genre the player said Never to, or -1. */
function gridFor(S: PlayState, data: CastData, f: CastFace): number {
  const times = history(S).seen[f.id]?.[1] ?? 0
  for (let j = 0; j < f.grids.length; j++) {
    const g = (times + j) % f.grids.length
    if (!f.grids[g].some(([i]) => (data.titles[i].n ?? []).some(x => S.gen[x] <= -5))) return g
  }
  return -1
}

/**
 * Seven items easy → hard under the repeat rules above (Cast Call's faces, Line-up's posters).
 * `usable`: has a grid this player can get; `fits`: goes with the ones already picked. Starts the round in `H`.
 */
export function pickRound<X extends { tier: CastTier }>(H: CastHistory, items: X[], key: (x: X) => string, usable: (x: X) => boolean,
  rand = Math.random, fits: (x: X, picked: X[]) => boolean = () => true): X[] {
  const run = ++H.runs
  const fresh = (x: X) => !H.seen[key(x)]
  const back = (x: X) => !fresh(x) && run > FRESH_RUNS && run - H.seen[key(x)][0] >= GAP
  const freshLeft = items.some(x => fresh(x) && usable(x))
  const picked: X[] = []
  let returning = 0
  const take = (tier: CastTier, ok: (x: X) => boolean) => {
    for (const t of NEAR[tier]) {
      const xs = items.filter(x => x.tier === t && !picked.includes(x) && ok(x) && usable(x) && fits(x, picked))
      if (xs.length) return xs[Math.floor(rand() * xs.length)]
    }
    return null
  }
  for (const tier of ORDER) {
    let x = take(tier, fresh)
    if (!x && (returning < MAX_BACK || !freshLeft)) { x = take(tier, back); if (x) returning++ }
    if (!x) x = take(tier, back)              // not enough fresh ones: more of those seen 3+ rounds ago
    if (!x) x = take(tier, y => !fresh(y))   // a tiny pool only: anything not in this round
    if (!x) break
    picked.push(x)
  }
  return picked
}

/** A new round: seven faces, easy first. Starts the round in the history. */
export function castDeal(S: PlayState, data: CastData, rand = Math.random): CastDeal[] {
  return pickRound(history(S), data.faces, f => String(f.id), f => gridFor(S, data, f) >= 0, rand).map(face => {
    const grid = gridFor(S, data, face)
    return { face, grid, cells: face.grids[grid].map(([i, role]) => ({ title: data.titles[i], role })) }
  })
}

/** One grid as the play screen draws it, for either game: what's asked (a face, or a poster) and nine answers. */
export interface CastAsk { id: number; key: string; name: string; img: string; grid: number; cells: { k: string; name: string; img: string; role: string | null }[] }
export const castAsk = (d: CastDeal): CastAsk => ({
  id: d.face.id, key: String(d.face.id), name: d.face.name, img: d.face.img, grid: d.grid,
  cells: d.cells.map(c => ({ k: c.title.k, name: c.title.t, img: c.title.p, role: c.role })),
})

/** A face counts as seen when it's on screen, not when it's dealt. */
export function castShown(S: PlayState, f: CastFace) {
  const H = history(S)
  H.seen[f.id] = [H.runs, (H.seen[f.id]?.[1] ?? 0) + 1]
}

/** A grid's points: +1 a right poster, −1 a wrong one, +2 more for all four right. */
export const castPoints = (hit: number, wrong: number) => hit - wrong + (hit === CAST_PICKS && wrong === 0 ? CAST_PERFECT_POINTS : 0)

/** The time bonus, earned only by finishing all seven with enough right: a point per 2 seconds left. */
export const castTimeBonus = (done: boolean, right: number, leftMs: number) =>
  done && right >= CAST_TIME_MIN_RIGHT ? Math.floor(Math.max(0, leftMs) / CAST_TIME_PER_POINT) : 0

/** Bests made under older rules (10 faces, no bonuses) don't compare: they're cleared once. */
export function castRulesUpdate(S: PlayState) {
  const H = history(S)
  if (H.v === RULES_V) return
  if (S.gameBest) delete S.gameBest.cast
  H.v = RULES_V
}

/** m:ss, for "7 faces in 0:51". */
export function castClock(ms: number) {
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
