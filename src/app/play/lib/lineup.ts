/**
 * Line-up (Eran, 2026-10-30): Cast Call reversed. A poster and nine faces:
 * "Select 4 actors in …". Same clock, points, bonuses and repeat rules as
 * Cast Call (lib/cast.ts); mock-ups in docs/prototypes/line-up/. Built by
 * scripts/build-line-up.mts from the live catalogue: every right face is
 * top-8 billed, every wrong face has no credit at all on the title.
 *
 * A round never brings two posters from one franchise, and no face shows up
 * on more than two of its posters.
 */
import type { PlayState } from './brain'
import type { GameGenre } from './genres'
import { pickRound, type CastAsk, type CastHistory, type CastTier } from './cast'

export interface LineupFace { id: number; name: string; img: string; w?: 1 }
/** A grid cell: an index into `faces`, and the character they played (null = a wrong face). */
export type LineupCell = [number, string | null]
export interface LineupTitle { k: string; t: string; y: number; p: string; tier: CastTier; n?: GameGenre[]; f?: string; grids: LineupCell[][] }
export interface LineupData { built: string; faces: LineupFace[]; titles: LineupTitle[] }

const MAX_FACE = 2
const history = (S: PlayState): CastHistory => (S.lineup ??= { runs: 0, seen: {} })
const blocked = (S: PlayState, t: LineupTitle) => (t.n ?? []).some(x => S.gen[x] <= -5)
const gridOf = (S: PlayState, t: LineupTitle) => (history(S).seen[t.k]?.[1] ?? 0) % t.grids.length

/** A new round: seven posters, easy first, as the play screen draws them. Starts the round in the history. */
export function lineupDeal(S: PlayState, data: LineupData, rand = Math.random): CastAsk[] {
  const faceCount = (picked: LineupTitle[], extra: LineupTitle) => {
    const n = new Map<number, number>()
    for (const t of [...picked, extra]) for (const [i] of t.grids[gridOf(S, t)]) n.set(i, (n.get(i) ?? 0) + 1)
    return Math.max(...n.values())
  }
  const fits = (t: LineupTitle, picked: LineupTitle[]) =>
    !(t.f && picked.some(x => x.f === t.f)) && faceCount(picked, t) <= MAX_FACE
  return pickRound(history(S), data.titles, t => t.k, t => !blocked(S, t), rand, fits).map((t, id) => {
    const grid = gridOf(S, t)
    return {
      id, key: t.k, name: t.t, img: t.p, grid,
      cells: t.grids[grid].map(([i, role]) => ({ k: String(data.faces[i].id), name: data.faces[i].name, img: data.faces[i].img, role })),
    }
  })
}

/** A poster counts as seen when it's on screen, not when it's dealt. */
export function lineupShown(S: PlayState, key: string) {
  const H = history(S)
  H.seen[key] = [H.runs, (H.seen[key]?.[1] ?? 0) + 1]
}
