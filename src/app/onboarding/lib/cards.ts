/**
 * P2-U3 · The rating cards of the new onboarding: the rules, without the screen. Signed off by Eran in P2-U0
 * (docs/plan/PLAN.md → P2-U0, the card and parts 3–4):
 *
 *   - The cards come in the order of learner-cards.json (P2-U1), skipping titles in a "Never" genre (by the 16
 *     genres, so "Never: Superheroes" hides Iron Man, and by the 13 the season blocks with).
 *   - **Ends at 30 rated or 90 shown** (DEC-11), or "Go to quick picks" / Skip. Every way out goes to the screen
 *     before the picks.
 *   - The count and the bar move only on a rating; "Haven't seen" just brings the next card.
 *   - **Milestones** on the card after the 10th and the 20th rating.
 *   - **Message 1** after 10 shown with 2 or fewer rated; **message 2** after 20 shown with 4 or fewer. Each once.
 *   - No going back.
 */
import type { Title } from '@/app/play/lib/brain'
import type { Genre16 } from '@/app/play/lib/genres16'
import { to13, type GenreAnswers } from './genre-step'
import LEARNER from '../data/learner-cards.json'
import GENRES16 from '../data/genres16.json'

export const TARGET = 30
export const CAP = 90
export const MAX_CARD_ANSWERS = 10
/** The whole set-up's bar: 30 ratings and 12 picks (the mocks' SETUP_TOTAL). */
export const SETUP_TOTAL = 42

export type Rating = 'loved' | 'liked' | 'disliked'
export type CardAnswer = { id: string; r: Rating | 'unseen' }

export const MILESTONES: Record<number, string> = { 10: 'A third of the way', 20: '10 more to go' }

/** Saved in play_state (`state.onboarding.cards`), so a visit later resumes on the next card. */
export interface CardsState {
  /** The next index into learner-cards.json to try (Never titles are skipped as it moves). */
  i: number
  rated: { id: string; r: Rating }[]
  unseen: string[]
  /** Messages already shown (1, 2): each appears once. */
  msgs: number[]
  /** How the cards ended, once they have. */
  end?: 'thirty' | 'cap' | 'early'
}

export type CardsEnd = NonNullable<CardsState['end']>
export type Message = 1 | 2

export const freshCards = (): CardsState => ({ i: 0, rated: [], unseen: [], msgs: [] })
export const shownCount = (c: CardsState) => c.rated.length + c.unseen.length

const G16 = GENRES16 as Record<string, Genre16[]>

/** A title the genre answers rule out: one of its 16 genres is Never, or the season would block it (13). */
export function blocked(t: Title, answers: GenreAnswers): boolean {
  if ((G16[t.id] ?? []).some(g => answers[g] === 'never')) return true
  const v13 = to13(answers)
  return (t.never ?? t.genres).some(g => v13[g] <= -5)
}

/** The next card from index `i` on, or null when the set runs out. */
export function nextCard(i: number, answers: GenreAnswers, byId: Map<string, Title>): { t: Title; i: number } | null {
  const keys = LEARNER as string[]
  for (let k = i; k < keys.length; k++) {
    const t = byId.get(keys[k])
    if (t && !blocked(t, answers)) return { t, i: k }
  }
  return null
}

/**
 * Record an answer to the card at index `at`. Returns the new state, and what comes next: the end of the cards,
 * a message, or another card (with a milestone when this rating was the 10th or 20th).
 */
export function answer(c: CardsState, at: number, id: string, r: Rating | 'unseen', answers: GenreAnswers, byId: Map<string, Title>):
  { c: CardsState; next: { end: CardsEnd } | { message: Message } | { card: Title; at: number; milestone: string | null } } {
  const n: CardsState = r === 'unseen'
    ? { ...c, i: at + 1, unseen: [...c.unseen, id] }
    : { ...c, i: at + 1, rated: [...c.rated, { id, r }] }
  const shown = shownCount(n), rated = n.rated.length
  if (rated >= TARGET) return { c: { ...n, end: 'thirty' }, next: { end: 'thirty' } }
  const card = nextCard(n.i, answers, byId)
  if (shown >= CAP || !card) return { c: { ...n, end: 'cap' }, next: { end: 'cap' } }
  if (shown === 10 && rated <= 2 && !n.msgs.includes(1)) return { c: { ...n, msgs: [...n.msgs, 1] }, next: { message: 1 } }
  if (shown === 20 && rated <= 4 && !n.msgs.includes(2)) return { c: { ...n, msgs: [...n.msgs, 2] }, next: { message: 2 } }
  return { c: n, next: { card: card.t, at: card.i, milestone: r !== 'unseen' ? MILESTONES[rated] ?? null : null } }
}

/** "Go to quick picks" (message 2) and Skip: the cards end here. */
export const endEarly = (c: CardsState): CardsState => ({ ...c, end: 'early' })

/** What the screen before the picks says (P2-U0 part 4). Curly apostrophes, as signed off. */
export function betweenCopy(c: CardsState): { head: string; line: string; label: string | null; posters: { id: string; r: Rating }[]; badges: boolean } {
  const n = c.rated.length
  const count = (r: Rating) => c.rated.filter(x => x.r === r).length
  const numbers = `You loved ${count('loved')}, liked ${count('liked')} and disliked ${count('disliked')}.`
  const loved = c.rated.filter(x => x.r === 'loved')
  if (n === 0) return { head: 'On to the picks.', line: 'No ratings yet, and that’s fine: the picks work even with titles you haven’t seen.', label: null, posters: [], badges: false }
  if (c.end === 'early') return { head: `${n} rated. That’s fine.`, line: 'The picks will do the rest.', label: 'What you rated', posters: c.rated, badges: true }
  const head = c.end === 'thirty' ? 'That’s 30.' : `${n} rated. That’s enough.`
  return { head, line: numbers, label: loved.length ? 'What you loved' : null, posters: loved, badges: false }
}

/** The posters for a message: the last three "Haven't seen" titles. */
export const lastUnseen = (c: CardsState, k = 3) => c.unseen.slice(-k)

/** The same title key the feed files ratings under (`type:tmdb_id`): the game title ids already are. */
export const isGameKey = (id: string) => /^(movie|tv):\d+$/.test(id)
