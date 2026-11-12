/**
 * P2-U2 · The genre step of the new onboarding: what its answers do (the screen is components/GenreStep.tsx).
 *
 * People answer on the 16 genres they see (src/app/play/lib/genres16.ts). Two things read the answers:
 *   - the exact Nevers, written to Taste DNA from `onboarding.genres16` (update-from-play.ts → genre16Rule);
 *   - everything that works on the 13 (the quick picks' picker, the starter feed, the genre lean #278), from `gen`.
 * Here the 16 answers become the 13 values the season's genre step writes: Love 2, Like 1, Never −9, else 0.
 */
import { freshState, type PlayState } from '@/app/play/lib/brain'
import { GAME_GENRES, type GameGenre } from '@/app/play/lib/genres'
import { GENRES_16, GENRE_13_OF, type Genre16 } from '@/app/play/lib/genres16'

export type GenreAnswer = 'love' | 'like' | 'never'
export type GenreAnswers = Partial<Record<Genre16, GenreAnswer>>

/** Start needs at least one Love or Like (a Never alone doesn't count): the picks have to start somewhere. */
export const canStart = (a: GenreAnswers) => Object.values(a).some(v => v === 'love' || v === 'like')

/**
 * The 13 values. A 13-genre takes the strongest Love / Like among the 16 that sit on it. It's a Never only when
 * every one of those 16 is a Never: "Never: Superheroes" alone must not hide all of sci-fi from the picks.
 */
export function to13(a: GenreAnswers): Record<GameGenre, number> {
  const out = Object.fromEntries(GAME_GENRES.map(g => [g.id, 0])) as Record<GameGenre, number>
  for (const g13 of GAME_GENRES.map(g => g.id)) {
    const mine = GENRES_16.filter(g => GENRE_13_OF[g.id] === g13).map(g => a[g.id])
    if (mine.includes('love')) out[g13] = 2
    else if (mine.includes('like')) out[g13] = 1
    else if (mine.length && mine.every(v => v === 'never')) out[g13] = -9
  }
  return out
}

/**
 * The state after Start: the answers on both lists, and the step moved on to the cards. Built on the saved state
 * when there is one (a returning visit), else a fresh one.
 */
export function applyGenreStep(saved: PlayState | null, a: GenreAnswers): PlayState {
  const S: PlayState = saved ? structuredClone(saved) : freshState()
  S.gen = { ...S.gen, ...to13(a) }
  const loves = GAME_GENRES.filter(g => S.gen[g.id] >= 1).map(g => g.id)
  S.sel = loves.length ? loves : null
  S.loved = GAME_GENRES.filter(g => S.gen[g.id] >= 2).map(g => g.id)
  S.onboarding = { ...S.onboarding, genres16: { ...a }, step: 'cards' }
  return S
}
