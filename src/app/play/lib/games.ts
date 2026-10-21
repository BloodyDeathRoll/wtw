/**
 * The three games woven into the season (decided with Eran 2026-10-18):
 * Blind Taste Test, The Other Side of the Story, Higher or Lower. All three
 * run on real catalogue data only — nothing is written or invented:
 *
 *   - Blind Taste Test, "book cover" edition (Eran 2026-10-21): the story
 *     told without what people judge on sight (it's animated, a series, old,
 *     not in English, a true story), from data/blind-covers.json. Would you
 *     watch it? Then the cover is revealed, and they answer again.
 *   - The Other Side of the Story: five side characters each tell the story
 *     in their own words, hardest first (data/other-clues.json; real details
 *     from the film, not only TMDB's plot — Eran 2026-10-19, no big twists).
 *     Guess early, score more; "Haven't seen it" ends a story at any clue.
 *   - Higher or Lower: which of two has the higher TMDB rating (or came out
 *     first)? Keep a streak going.
 *
 * Every item served is remembered per game (`PlayState.served`) and never
 * served again, so a season step stays fresh even after the player has played
 * that game in Games (Eran's rule).
 */
import { isBlocked, type PlayState, type Title } from './brain'
import type { BlindCover, GameTitle, SideClue } from './scales'

export type GameKind = 'blind' | 'other' | 'hilo'

// ── Levels ─────────────────────────────────────────────────────────

export interface GameLevel {
  label: string; size: number; kind?: 'movie' | 'tv'; deep?: boolean; mode?: 'rating' | 'year'
  /** Blind Taste Test: which kind of cover the level hides (`BlindCover.level`). */
  cover?: BlindCover['level']
  /** Deal from the whole pool, famous and lesser-known alike. */
  any?: boolean
}

export const LEVELS: Record<GameKind, GameLevel[]> = {
  // Blind Taste Test (Eran 2026-10-21): five stories a round, each level
  // hiding a different kind of cover. Level 1 opens the season's step.
  blind: [
    { label: 'Not who you think', size: 5, cover: 1 },
    { label: 'Longer than you think', size: 5, cover: 2, kind: 'tv', any: true },
    { label: 'Older than it sounds', size: 5, cover: 3, any: true },
    { label: 'Not in English', size: 5, cover: 4, any: true },
    { label: 'Never heard of it', size: 5, cover: 5, any: true },
  ],
  other: [
    { label: '3 stories', size: 3 },
    { label: '4 stories', size: 4 },
    { label: 'Series edition', size: 3, kind: 'tv' },
    { label: 'Deep cuts', size: 4, deep: true },
    { label: '5 stories', size: 5, deep: true },
  ],
  // Higher or Lower: `size` is the streak that clears the level.
  hilo: [
    { label: 'Ratings · 5 in a row', size: 5, mode: 'rating' },
    { label: 'Ratings · 8 in a row', size: 8, mode: 'rating' },
    { label: 'Which came first? · 6 in a row', size: 6, mode: 'year' },
    { label: 'Series ratings · 6 in a row', size: 6, mode: 'rating', kind: 'tv' },
    { label: 'Ratings · 10 in a row', size: 10, mode: 'rating', deep: true },
  ],
}

// ── Served items: never twice ─────────────────────────────────────────

export const served = (S: PlayState, g: GameKind) => (S.served ??= {})[g] ??= []
export function markServed(S: PlayState, g: GameKind, id: string) {
  const list = served(S, g)
  if (!list.includes(id)) list.push(id)
}

function shuffle<T>(a: T[], rand: () => number): T[] {
  const b = [...a]
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [b[i], b[j]] = [b[j], b[i]] }
  return b
}

/** Titles a game may use: not "Never", right format, not served before in this game. */
function poolFor(S: PlayState, T: Title[], g: GameKind, lv: GameLevel): Title[] {
  const done = new Set(served(S, g))
  return T.filter(t =>
    !done.has(t.id) && !isBlocked(S, t)
    && (lv.kind ? t.type === lv.kind : S.format === 'movies' ? t.type === 'movie' : S.format === 'series' ? t.type === 'tv' : true))
}

/**
 * Level 1 sticks to famous titles; deep levels to the less-known half. Varied
 * like the training: one title per film series and per loose group (no deck
 * of five Marvel films), nothing from a group the player keeps turning down.
 */
function byFame(pool: Title[], lv: GameLevel, rand: () => number, S?: PlayState): Title[] {
  const ok = pool.filter(t => !t.groups?.some(g => (S?.groupLean?.[g] ?? 0) <= -2))
  const famous = ok.filter(t => (lv.deep ? t.pop < 0.6 : t.pop >= 0.55))
  const ordered = shuffle(!lv.any && famous.length >= lv.size * 2 ? famous : ok, rand)
  const out: Title[] = [], series = new Set<string>(), groups = new Set<string>()
  for (const t of ordered) {
    if (t.collection && series.has(t.collection)) continue
    if (t.groups?.some(g => groups.has(g))) continue
    out.push(t)
    if (t.collection) series.add(t.collection)
    for (const g of t.groups ?? []) groups.add(g)
  }
  return [...out, ...ordered.filter(t => !out.includes(t))]
}

/** Three wrong answers that look plausible: same format, sharing a genre, similar fame, close in time if possible. */
export function options(T: Title[], answer: Title, rand = Math.random): Title[] {
  const near = T.filter(t => t.id !== answer.id && t.type === answer.type && t.genres.some(g => answer.genres.includes(g)))
  // About as well-known as the answer, so a famous film never sits next to an obscure documentary.
  const alike = near.filter(t => Math.abs(t.pop - answer.pop) <= 0.35)
  const closeInTime = alike.filter(t => Math.abs((t.year ?? 0) - (answer.year ?? 0)) <= 12)
  const src = closeInTime.length >= 3 ? closeInTime : alike.length >= 3 ? alike : near.length >= 3 ? near : T.filter(t => t.id !== answer.id && t.type === answer.type)
  return shuffle([answer, ...shuffle(src, rand).slice(0, 3)], rand)
}

// ── Blind Taste Test ──────────────────────────────────────────────────

/**
 * Attach each title's Blind Taste Test cover (`GameTitle.cover`): the story
 * told without what people judge on sight, and the line that reveals it.
 */
export function withBlindCovers<T extends GameTitle>(titles: T[], covers: Record<string, BlindCover>): T[] {
  return titles.map(t => (covers[t.id] ? { ...t, cover: covers[t.id] } : t))
}

/** Stories at one Blind level, varied like the other decks. */
function coverDeck(S: PlayState, T: Title[], lv: GameLevel, rand: () => number): Title[] {
  const pool = poolFor(S, T, 'blind', lv).filter(t => t.cover?.level === lv.cover)
  return byFame(pool, lv, rand, S).slice(0, lv.size)
}

/**
 * A round of Blind Taste Test at `level` (0-based). A level whose stories have
 * run out hands over to the next one that still has a full round, so a keen
 * player keeps playing until every level is spent.
 */
export function blindDeck(S: PlayState, T: Title[], level: number, rand = Math.random): { deck: Title[]; level: number } {
  const levels = LEVELS.blind
  for (let k = 0; k < levels.length; k++) {
    const at = (level + k) % levels.length
    const deck = coverDeck(S, T, levels[at], rand)
    if (deck.length >= MIN_BLIND_ROUND) return { deck, level: at }
  }
  return { deck: [], level }
}

/** Fewer stories than this left at every level: Blind has run out for now. */
const MIN_BLIND_ROUND = 3

/**
 * What the story card may show under the story without giving the cover
 * away: nothing at all on "Longer than you think" (its cover is being a
 * series), else movie or series and a movie's running time. Never a year,
 * a genre or "animated".
 */
export function blindChips(t: Title): string[] {
  if (t.cover?.level === 2) return []
  if (t.type === 'tv') return ['Series']
  return t.runtime ? ['Movie', `${Math.floor(t.runtime / 60)}h ${String(t.runtime % 60).padStart(2, '0')}m`] : ['Movie']
}

// ── The Other Side of the Story ───────────────────────────────────────

/** Attach each title's Other Side clues, where it has a full set of five. */
export function withSideClues<T extends GameTitle>(titles: T[], clues: Record<string, SideClue[]>): T[] {
  return titles.map(t => (clues[t.id]?.length === 5 ? { ...t, side: clues[t.id] } : t))
}

/** The five clues, hardest first: side characters telling the story in their own words. */
export const sideClues = (t: GameTitle): SideClue[] => t.side ?? []

export function otherDeck(S: PlayState, T: Title[], lv: GameLevel, rand = Math.random): Title[] {
  const pool = poolFor(S, T, 'other', lv).filter(t => sideClues(t).length === 5)
  return byFame(pool, lv, rand, S).slice(0, lv.size)
}

/**
 * The four answers only show from this clue on (Eran, 2026-10-19: on screen
 * from clue 1 they turned a memory game into a pick-from-a-list one). Before
 * that the player types; from here the four answers replace the text box.
 * Clue 4 is worth 2, about right for a multiple choice.
 */
export const OTHER_OPTIONS_FROM = 4

const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * Typed-guess suggestions from the whole catalogue (so the list can't give the
 * answer away): titles starting with the query first, then any word starting
 * with it, then anywhere; better-known first. Needs two characters.
 */
export function titleSearch(T: Title[], query: string, exclude: string[] = [], n = 5): Title[] {
  const q = fold(query)
  if (q.length < 2) return []
  const rank = (t: Title) => {
    const f = fold(t.title)
    if (f.startsWith(q)) return 0
    if (` ${f}`.includes(` ${q}`)) return 1
    return f.includes(q) ? 2 : 3
  }
  return T.filter(t => !exclude.includes(t.id))
    .map(t => ({ t, r: rank(t) }))
    .filter(x => x.r < 3)
    .sort((a, b) => a.r - b.r || b.t.pop - a.t.pop)
    .slice(0, n)
    .map(x => x.t)
}

/** Points for a right answer after `clue` clues (1-based): 5, 4, 3, 2, 1. */
export const otherPoints = (clue: number) => Math.max(1, 6 - clue)

// ── Higher or Lower ───────────────────────────────────────────────────

export const hiloValue = (t: Title, mode: 'rating' | 'year') => (mode === 'year' ? t.year ?? 0 : t.rating)

/** The next challenger for `current`: unserved, and never a near-tie (a fair question). */
export function hiloNext(S: PlayState, T: Title[], lv: GameLevel, current: Title | null, rand = Math.random): Title | null {
  const mode = lv.mode ?? 'rating'
  const gap = mode === 'year' ? 3 : 0.3
  const pool = byFame(poolFor(S, T, 'hilo', lv), lv, rand, S)
  return pool.find(t => t.id !== current?.id && (!current || Math.abs(hiloValue(t, mode) - hiloValue(current, mode)) >= gap)) ?? null
}
