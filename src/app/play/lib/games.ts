/**
 * The three games woven into the season (decided with Eran 2026-10-18):
 * Blind Taste Test, The Other Side of the Story, Higher or Lower. All three
 * run on real catalogue data only — nothing is written or invented:
 *
 *   - Blind Taste Test: the TMDB plot retold without names or giveaways
 *     (data/plot-rewrites.json — re-worded and blurred, nothing added; Eran
 *     2026-10-18). Would you watch it? Then: which movie is it?
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
import type { GameTitle, SideClue } from './scales'

export type GameKind = 'blind' | 'other' | 'hilo'

// ── Levels ─────────────────────────────────────────────────────────

export interface GameLevel { label: string; size: number; kind?: 'movie' | 'tv'; deep?: boolean; mode?: 'rating' | 'year' }

export const LEVELS: Record<GameKind, GameLevel[]> = {
  blind: [
    { label: '6 plots', size: 6 },
    { label: '8 plots', size: 8 },
    { label: 'Series plots', size: 6, kind: 'tv' },
    { label: 'Deep cuts', size: 8, deep: true },
    { label: '10 plots', size: 10, deep: true },
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
  const ordered = shuffle(famous.length >= lv.size * 2 ? famous : ok, rand)
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

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'over', 'part', 'show', 'story', 'life', 'man', 'men', 'world', 'game', 'love', 'house', 'night', 'day', 'black', 'white', 'king', 'last', 'first', 'new', 'old', 'big', 'little', 'great', 'good', 'dark', 'war', 'time', 'one', 'two', 'three'])

/**
 * Words to black out, each with whether case matters. Character names (full
 * and their parts) only match as Names, so "Nova Prime" hides "Prime" but not
 * "the prime target", and an "Agent Rhodes" leaves "an FBI agent" alone.
 * Title words match in any case: "interstellar" gives Interstellar away.
 */
function secretWords(t: Title): { w: string; exact: boolean }[] {
  const words = new Map<string, boolean>()
  const add = (w: string, exact: boolean) => words.set(w, (words.get(w) ?? true) && exact)
  for (const c of t.characters) {
    const clean = c.replace(/["'“”‘’]/g, ' ').replace(/\s+/g, ' ').trim()
    if (clean.length >= 3) add(clean, true)
    for (const part of clean.split(/[\s.,/-]+/)) if (part.length >= 3 && /^[A-Z]/.test(part) && !STOP.has(part.toLowerCase())) add(part, true)
  }
  for (const part of t.title.split(/[\s:,.!?'-]+/)) if (part.length >= 4 && !STOP.has(part.toLowerCase())) add(part, false)
  for (const w of t.aliases ?? []) if (!STOP.has(w.toLowerCase())) add(w, false)
  // A keyword the plot uses as a Name ("Batman") is a giveaway too.
  for (const k of t.keywords ?? []) {
    const cap = k[0].toUpperCase() + k.slice(1)
    if (!STOP.has(k.toLowerCase()) && new RegExp(`\\b${escape(cap)}\\b`).test(t.overview)) add(cap, true)
  }
  return [...words].map(([w, exact]) => ({ w, exact })).sort((a, b) => b.w.length - a.w.length)
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Below this a retold plot says too little to judge (e.g. "The early life of a boy genius."). */
const MIN_BLIND = 45

/**
 * Attach each title's retold plot (`GameTitle.blind`) — only where TMDB's
 * plot is still the one the rewrite was made from, so a changed plot falls
 * back to the blacked-out original instead of showing stale text.
 */
export function withBlindPlots<T extends GameTitle>(titles: T[], rewrites: Record<string, { src: string; text: string }>): T[] {
  return titles.map(t => (rewrites[t.id]?.src === t.overview ? { ...t, blind: rewrites[t.id].text } : t))
}

/** The plot a Blind Taste Test card shows: the retold one, else the original with names blacked out. */
export const blindPlot = (t: Title): string => t.blind ?? redact(t)

/**
 * The plot with names blacked out. Returns text with ▇ blocks in place of
 * each secret word ("▇▇▇▇'s" keeps a possessive readable). Nothing is
 * rewritten or added — the rest is TMDB's own overview.
 */
export function redact(t: Title): string {
  let text = t.overview
  for (const { w, exact } of secretWords(t)) {
    text = text.replace(new RegExp(`\\b${escape(w)}\\b`, exact ? 'g' : 'gi'), m => '▇'.repeat(Math.min(6, Math.max(3, Math.round(m.length / 2)))))
  }
  return text
}

export function blindDeck(S: PlayState, T: Title[], lv: GameLevel, rand = Math.random): Title[] {
  // A plot needs to say something once the names are gone.
  const pool = poolFor(S, T, 'blind', lv).filter(t => t.blind ? t.blind.length >= MIN_BLIND : t.overview.length >= 90 && redact(t).replace(/▇+/g, '').length >= 70)
  return byFame(pool, lv, rand, S).slice(0, lv.size)
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
