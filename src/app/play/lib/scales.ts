/**
 * The hidden taste scales every game title sits on, each from -1 (left label)
 * to +1 (right label). Same ids and order as the approved prototype
 * (docs/prototypes/wtw-taste-test.html), so its brain logic ports unchanged.
 */
import type { GameGenre } from './genres'

export const CORE_SCALES = ['tone', 'energy', 'pace', 'dark', 'complex', 'fantastic', 'modern', 'indie'] as const
/** Only some titles carry these: `humor` comedies, `commit` series. */
export const EXTRA_SCALES = ['humor', 'commit'] as const

export type CoreScale = (typeof CORE_SCALES)[number]
export type ExtraScale = (typeof EXTRA_SCALES)[number]
export type Scale = CoreScale | ExtraScale

export const SCALE_LABELS: Record<Scale, [left: string, right: string]> = {
  tone:      ['Serious', 'Funny'],
  energy:    ['Talk', 'Action'],
  pace:      ['Slow burn', 'Fast'],
  dark:      ['Light', 'Dark'],
  complex:   ['Easy watch', 'Puzzle'],
  fantastic: ['Real world', 'Other worlds'],
  modern:    ['Classic', 'Recent'],
  indie:     ['Blockbuster', 'Off-beat'],
  humor:     ['Silly', 'Dry wit'],
  commit:    ['Mini-series', 'Long haul'],
}

/**
 * The same ends as words that fit a sentence ("It's twisty", "Actually, I like
 * it talky"). SCALE_LABELS read well on a slider but not in a sentence: found
 * 2026-10-19 as "It's puzzle, and so are the titles you pick."
 */
export const SCALE_WORDS: Record<Scale, [left: string, right: string]> = {
  tone:      ['serious', 'funny'],
  energy:    ['talky', 'action-packed'],
  pace:      ['slow-burning', 'fast'],
  dark:      ['light', 'dark'],
  complex:   ['easy to follow', 'twisty'],
  fantastic: ['down-to-earth', 'otherworldly'],
  modern:    ['classic', 'recent'],
  indie:     ['mainstream', 'off-beat'],
  humor:     ['silly', 'dry'],
  commit:    ['short', 'long-running'],
}

/** Scales the model judges. The rest come from facts (year, votes, seasons). */
export const AI_SCALES = ['tone', 'energy', 'pace', 'dark', 'complex', 'fantastic', 'humor'] as const
export type AIScale = (typeof AI_SCALES)[number]

/** One title in the game's catalogue (`src/app/play/data/titles.json`). */
/** One Other Side clue. `src` says where its facts come from: TMDB's plot, or the film itself (Eran, 2026-10-19). */
export interface SideClue { who: string; text: string; src: 'tmdb' | 'film' }

export interface GameTitle {
  /** `${type}:${tmdb_id}`, the same composite key as src/lib/title-key.ts. */
  id: string
  tmdb_id: string
  type: 'movie' | 'tv'
  title: string
  year: number | null
  poster_path: string | null
  genres: GameGenre[]
  /**
   * Genres the title MIGHT belong to — a superset of `genres`, used only to
   * block a "Never" genre. Keyword hints are loose, so blocking errs wide.
   */
  never: GameGenre[]
  /** TMDB's plot overview, cut to whole sentences — real text, never rewritten. */
  overview: string
  /**
   * Blind Taste Test's version of the plot: `overview` retold with no names
   * or giveaways, adding nothing (data/plot-rewrites.json). Attached at load
   * by `withBlindPlots`, and only while TMDB's plot is the one it was made from.
   */
  blind?: string
  /**
   * The Other Side of the Story: five side characters each telling the story
   * in their own words, hardest first (data/other-clues.json, written for ~120
   * well-known titles). Attached at load by `withSideClues`.
   */
  side?: SideClue[]
  /** Directors for movies, creators for series. */
  creators: string[]
  runtime: number | null
  /** TMDB collection for movies in a series ("Harry Potter Collection"), else null. */
  collection: string | null
  /** Character names in billing order, leads first (TMDB credits). For the games. */
  characters: string[]
  /** A few single-word TMDB keywords ("batman"), for blacking names out of plots. */
  keywords: string[]
  /** More giveaway words: titles of the rest of its film series, plus hand-added ones. */
  aliases: string[]
  /** Loose groups that mustn't crowd the duels, e.g. ['superhero']. */
  groups: string[]
  /** YouTube key of the trailer, from the catalogue (null = none found). */
  trailer_key: string | null
  /** Subscription service in the US, one brand (src/lib/watch-providers.ts). Source: JustWatch via TMDB. */
  where: string | null
  seasons: number | null
  episodes: number | null
  votes: number
  rating: number
  /** 0..1, how well-known within its own type in this set (1 = most voted). */
  pop: number
  scales: Partial<Record<Scale, number>>
}

const clamp = (x: number) => Math.max(-1, Math.min(1, x))
const round2 = (x: number) => Math.round(x * 100) / 100

/**
 * Centre a scale on the set's own average and stretch it so 1.5 standard
 * deviations reach the ends. Keeps the shape of the model's judgement but
 * removes its base-rate bias — the catalogue's enrichment calls 60% of all
 * titles "dark" (docs/INTEGRATION.md, Open now row 4), and a scale where
 * everything leans one way can't tell two titles apart.
 */
export function spread(values: number[]): number[] {
  if (values.length === 0) return []
  const mean = values.reduce((s, v) => s + v, 0) / values.length
  const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length)
  if (sd === 0) return values.map(() => 0)
  return values.map(v => round2(clamp((v - mean) / (1.5 * sd))))
}

/**
 * Rank position mapped onto -1..1 (lowest → -1, highest → +1, ties share the
 * average rank). For facts like release year, where only the order matters.
 */
export function rankSpread(values: number[]): number[] {
  const n = values.length
  if (n === 0) return []
  if (n === 1) return [0]
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v)
  const out = new Array<number>(n)
  for (let start = 0; start < n; ) {
    let end = start
    while (end + 1 < n && order[end + 1].v === order[start].v) end++
    const rank = (start + end) / 2
    for (let k = start; k <= end; k++) out[order[k].i] = round2((rank / (n - 1)) * 2 - 1)
    start = end + 1
  }
  return out
}
