/**
 * "Why this?" facts from formula v2 (docs/plan/PLAN.md P1-E5). Pure.
 *
 * Formula v2 drops story match, pace & tone and genre habits, so the facts
 * the Why writer used to get from them come from the taste model instead:
 * `contributions` (w_k·x_k per input) say which of the title's scales and
 * genres pull this viewer in or push them away, and the title's own vector
 * says what it is like. Every claim is one of these numbers said in words.
 *
 * Inputs (src/lib/taste-scales/features.ts): [0] rating (not taste: never
 * said), [1..13] game genres, [14..23] scales, [24] audience.
 */
import { FEATURE_GENRES, FEATURE_SCALES } from '@/lib/taste-scales/features'
import { SCALE_WORDS, type TasteScale } from '@/app/play/lib/scales'
import type { GameGenre } from '@/app/play/lib/genres'
import { normalCdf, type V2Score } from '../scoring/formula-v2'

/** A scale end is "clear" (said as what the title is) at |value| ≥ this. */
export const CLEAR_SCALE = 0.5
/** The catch needs a pull at least this strong (PLAN P1-E5). */
export const CATCH_BELOW = -0.05
/** Bars are z-scores within the pool; under this many titles they mean little. */
export const BARS_MIN_POOL = 20
/** Step 6: "Doesn't quite fit" lines (PLAN P1-E5). */
export const NEG_MODEL_Z = -0.5
export const NEG_CROWD_Z = -1

type Input = { kind: 'genre'; key: GameGenre } | { kind: 'scale'; key: TasteScale }

/** Index → what it is. [0] (rating) is the crowd's, not taste: left out. */
const INPUTS: (Input | null)[] = [
  null,
  ...FEATURE_GENRES.map(key => ({ kind: 'genre' as const, key })),
  ...FEATURE_SCALES.map(key => ({ kind: 'scale' as const, key })),
  { kind: 'scale', key: 'audience' },
]

/** Genres as a sentence says them. */
export const GENRE_SAY: Record<GameGenre, string> = {
  action: 'action', anim: 'animation', anime: 'anime', comedy: 'comedy', crime: 'crime', doc: 'documentary',
  drama: 'drama', family: 'family', horror: 'horror', romance: 'romance', scifi: 'sci-fi and fantasy',
  thriller: 'thriller and mystery', war: 'war and history',
}

/** Genres in a list ("crime, thriller & mystery"): GENRE_SAY joined by "and" read badly. */
const GENRE_LIST: Record<GameGenre, string> = {
  ...GENRE_SAY, scifi: 'sci-fi & fantasy', thriller: 'thriller & mystery', war: 'war & history',
}

/** "It's ___ than this viewer usually goes for", by the end the title sits at. */
const COMPARATIVE: Record<TasteScale, [left: string, right: string]> = {
  tone:      ['more serious', 'funnier'],
  energy:    ['talkier', 'more action-packed'],
  pace:      ['slower', 'faster'],
  dark:      ['lighter', 'darker'],
  complex:   ['easier to follow', 'twistier'],
  fantastic: ['more down-to-earth', 'more otherworldly'],
  modern:    ['older', 'newer'],
  indie:     ['more mainstream', 'more off-beat'],
  humor:     ['sillier', 'drier'],
  commit:    ['shorter', 'longer-running'],
  audience:  ['more kid-friendly', 'more grown-up'],
}

const side = (x: number) => (x > 0 ? 1 : 0)
const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

/** True when this title carries v2 facts. */
export const hasTasteFacts = (v2: V2Score | undefined): v2 is V2Score & { vec: number[]; contributions: number[] } =>
  Boolean(v2?.vec && v2.contributions)

/**
 * The personal lines: the top 2 positive contributions among the genre and
 * scale inputs, said as what the viewer goes for. A scale is only said when
 * the title clearly sits at that end (|value| ≥ CLEAR_SCALE), so "this one is
 * dark" is true of the title, not just of the arithmetic.
 */
export function tasteLikes(contributions: number[], vec: number[]): string[] {
  const top = contributions
    .map((c, i) => ({ c, i, input: INPUTS[i] }))
    .filter(({ c, i, input }) => input && c > 0 && (input.kind === 'genre' || Math.abs(vec[i]) >= CLEAR_SCALE))
    .sort((a, b) => b.c - a.c)
    .slice(0, 2)

  const scales = top.filter(t => t.input!.kind === 'scale').map(t => SCALE_WORDS[t.input!.key as TasteScale][side(vec[t.i])])
  const genres = top.filter(t => t.input!.kind === 'genre').map(t => GENRE_SAY[t.input!.key as GameGenre])

  const lines: string[] = []
  if (scales.length) {
    lines.push(`This viewer goes for ${scales.join(', ')} stories, and this one is ${scales.length > 1 ? 'both' : scales[0]}.`)
  }
  for (const g of genres) lines.push(`${cap(g)} is a genre this viewer goes for.`)
  return lines
}

/**
 * The catch: the most negative contribution, if it is below CATCH_BELOW.
 * Said plainly (Eran, 2026-11-09: "we shouldn't be afraid of saying that").
 */
function worstPull(contributions: number[]) {
  return contributions
    .map((c, i) => ({ c, i, input: INPUTS[i] }))
    .filter(({ c, input }) => input && c < CATCH_BELOW)
    .sort((a, b) => a.c - b.c)[0]
}

export function tasteCatch(contributions: number[], vec: number[]): string | null {
  const worst = worstPull(contributions)
  if (!worst) return null
  const input = worst.input!
  if (input.kind === 'scale') return `It's ${COMPARATIVE[input.key][side(vec[worst.i])]} than this viewer usually goes for.`
  const g = GENRE_SAY[input.key]
  return `It's ${vec[worst.i] < 1 ? 'partly ' : ''}${g}, and ${g} isn't a genre this viewer usually goes for.`
}

/** Which catch a title gets, as a key ("16:1" = input 16, right end), so a batch can count them. Null: no catch. */
export function tasteCatchKey(contributions: number[], vec: number[]): string | null {
  const worst = worstPull(contributions)
  return worst ? `${worst.i}:${side(vec[worst.i])}` : null
}

/** A batch needs this many titles before "most of it shares a catch" means anything. */
export const SHARED_CATCH_MIN_BATCH = 20

/**
 * Catches more than half the batch shares (Eran, 2026-11-12, on #272: "More
 * mainstream than you usually go for" ended 8 of 10 sheets). A line on every
 * card says nothing, so a shared catch is not said; on a feed where few titles
 * share it, it still is.
 */
export function sharedCatchKeys(keys: (string | null)[]): Set<string> {
  const shared = new Set<string>()
  if (keys.length < SHARED_CATCH_MIN_BATCH) return shared
  const count = new Map<string, number>()
  for (const k of keys) if (k) count.set(k, (count.get(k) ?? 0) + 1)
  for (const [k, n] of count) if (n * 2 > keys.length) shared.add(k)
  return shared
}

/** The sheet's three bars, each Φ(z): Your taste, Crowd, Creators. Null when the pool is too small to compare against. */
export function tasteBars(v2: V2Score): { taste: number; crowd: number; creators: number } | null {
  if (v2.pool_size < BARS_MIN_POOL) return null
  return { taste: normalCdf(v2.z_model), crowd: normalCdf(v2.z_crowd), creators: normalCdf(v2.z_creators) }
}

/** "What it's like": the title's clear scale ends, strongest first, plus its genres and language. */
export function whatItsLike(vec: number[], originalLanguage: string | null | undefined): { dimension: 'feel' | 'genre' | 'language'; value: string }[] {
  const feel = INPUTS
    .map((input, i) => ({ input, x: vec[i] ?? 0 }))
    .filter(({ input, x }) => input?.kind === 'scale' && Math.abs(x) >= CLEAR_SCALE)
    .sort((a, b) => Math.abs(b.x) - Math.abs(a.x))
    .slice(0, 4)
    .map(({ input, x }) => SCALE_WORDS[input!.key as TasteScale][side(x)])
  const genres = INPUTS
    .map((input, i) => ({ input, x: vec[i] ?? 0 }))
    .filter(({ input, x }) => input?.kind === 'genre' && x > 0)
    .map(({ input }) => GENRE_LIST[input!.key as GameGenre])
  return [
    ...(feel.length ? [{ dimension: 'feel' as const, value: feel.join(', ') }] : []),
    ...(genres.length ? [{ dimension: 'genre' as const, value: genres.join(', ') }] : []),
    ...(originalLanguage ? [{ dimension: 'language' as const, value: originalLanguage }] : []),
  ]
}

/** The reservation/negative facts speak of "this viewer"; the sheet speaks to you. */
export const toYou = (s: string) => s
  .replace(/this viewer usually goes for/g, 'you usually go for')
  .replace(/this viewer's/g, 'your')
  .replace(/for this viewer/g, 'for you')
  .replace(/this viewer/g, 'you')

/** Step 6's "Doesn't quite fit" lines under v2, in the sheet's voice. `catchShared`: most of the batch has this catch, so it isn't said. */
export function tasteNegatives(v2: V2Score, catchShared = false): string[] {
  const out: string[] = []
  if (!catchShared && hasTasteFacts(v2) && v2.model_score != null && v2.z_model < NEG_MODEL_Z) {
    const c = tasteCatch(v2.contributions, v2.vec)
    if (c) out.push(toYou(c))
  }
  if (v2.z_crowd < NEG_CROWD_Z) out.push('Rated lower than what you usually pick.')
  return out
}
