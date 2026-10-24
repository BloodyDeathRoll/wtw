/**
 * Six Degrees (Eran, 2026-10-22 → 24; prototype docs/prototypes/six-degrees/play.html).
 *
 * Six actors from a start to an end; each was in a film or series with the
 * next. The player drags the middle four into order. Built by
 * scripts/build-six-chains.mts: every chain has exactly one right order, even
 * counting every credit these six ever had on TMDB.
 *
 * It's a memory game, not a guessing game: each actor shows the character
 * they play in the films shared with the actor above (↑) and below (↓), a
 * Check turns everyone in the right spot green, and the hints are films from
 * the chain, then one actor put in place.
 */
import { isBlocked, type PlayState, type Title } from './brain'

export interface SixActor { id: number; name: string; img: string | null; roles: string[] }
export interface SixFilm { id: string; title: string; year: number; poster: string | null }
export interface SixChain { id: string; actors: SixActor[]; films: SixFilm[] }

export const SIX_TRIES = 4
export const SIX_FILM_HINTS = 3
/** Three films, then one actor put in place. */
export const SIX_HINTS = SIX_FILM_HINTS + 1
const MIDDLE = [1, 2, 3, 4]

const served = (S: PlayState) => ((S.served ??= {}).six ??= [])

/**
 * The next chain: never one already played, none with a film from a "Never"
 * genre, and as far as possible nothing the player just saw: no face from the
 * last four chains and no film from the last six, then no face from the last
 * two, then anything left.
 */
export function sixDeal(S: PlayState, chains: SixChain[], T: Title[], rand = Math.random): SixChain | null {
  const done = new Set(served(S))
  const byId = new Map(T.map(t => [t.id, t]))
  const open = chains.filter(c => !done.has(c.id) && !c.films.some(f => { const t = byId.get(f.id); return t && isBlocked(S, t) }))
  if (!open.length) return null
  const last = (n: number) => served(S).slice(-n).map(id => chains.find(c => c.id === id)).filter((c): c is SixChain => !!c)
  const faces = (n: number) => new Set(last(n).flatMap(c => c.actors.map(a => a.id)))
  const films = (n: number) => new Set(last(n).flatMap(c => c.films.map(f => f.id)))
  const far = (f: Set<number>, m: Set<string>) => open.filter(c => !c.actors.some(a => f.has(a.id)) && !c.films.some(x => m.has(x.id)))
  const from = [far(faces(4), films(6)), far(faces(2), new Set()), open].find(xs => xs.length)!
  return from[Math.floor(rand() * from.length)]
}
export function markSixServed(S: PlayState, c: SixChain) {
  if (!served(S).includes(c.id)) served(S).push(c.id)
}

/** The board as dealt: ends fixed, and nobody in the middle starts in their right spot. */
export function sixStart(c: SixChain, rand = Math.random): number[] {
  const mid = MIDDLE.slice()
  do {
    for (let i = mid.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [mid[i], mid[j]] = [mid[j], mid[i]] }
  } while (mid.some((a, k) => a === MIDDLE[k]))
  return [0, ...mid, 5]
}

/** Board positions (1–4) whose actor is in the right spot. The board holds actor indexes into `c.actors`. */
export const sixRight = (board: number[]) => MIDDLE.filter(i => board[i] === i)

/**
 * Which film the next film hint shows: one the player hasn't been shown, and
 * preferably a link they haven't got yet (both its actors already green means
 * they know it). Middle links first; they help most.
 */
export function sixFilmHint(right: Set<number>, shown: number[]): number | null {
  const placed = (k: number) => k === 0 || k === 5 || right.has(k)
  const open = [2, 1, 3, 0, 4].filter(k => !shown.includes(k))
  return open.find(k => !(placed(k) && placed(k + 1))) ?? open[0] ?? null
}

/** The last hint: the first middle spot not yet right gets its actor; whoever was there swaps out. */
export function sixPlaceHint(board: number[], right: Set<number>): { board: number[]; spot: number } | null {
  const spot = MIDDLE.find(i => !right.has(i))
  if (spot === undefined) return null
  const next = board.slice(), from = next.indexOf(spot)
  ;[next[spot], next[from]] = [next[from], next[spot]]
  return { board: next, spot }
}

/** Out of 5: the first check is free; every extra check and every hint costs one. A solved chain scores at least 1. */
export const sixPoints = (checks: number, hints: number) => Math.max(1, 5 - Math.max(0, checks - 1) - hints)

/**
 * The character tags under an actor's name. ↑ is the film shared with
 * whoever belongs above, ↓ below (Eran, 2026-10-24); the start has only ↓,
 * the end only ↑. The same character in both films shows once as ↕, and a
 * double name ("Erik Lehnsherr / Magneto") shows the part people know.
 */
export function sixRoles(c: SixChain, k: number): { dir: '↑' | '↓' | '↕'; name: string; full: string }[] {
  const roles = c.actors[k].roles
  const short = (r: string) => r.split(' / ').pop()!.trim()
  if (roles.length === 2) {
    const [up, down] = roles.map(r => r.toLowerCase())
    if (up.includes(down) || down.includes(up)) {
      const full = roles[0].length >= roles[1].length ? roles[0] : roles[1]
      return [{ dir: '↕', name: short(full), full }]
    }
  }
  const dirs: ('↑' | '↓')[] = k === 0 ? ['↓'] : k === 5 ? ['↑'] : ['↑', '↓']
  return roles.map((r, i) => ({ dir: dirs[i], name: short(r), full: r }))
}
