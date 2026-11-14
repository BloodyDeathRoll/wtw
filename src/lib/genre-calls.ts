/**
 * Your call on a genre (P2-U8, the Taste DNA page; decided with Eran 2026-11-13).
 *
 * Each of the 16 genres has one call, five steps: Never · Less · Normal · More · Much more. Normal is no call at
 * all: your ratings alone decide how often the genre shows up (and keep deciding as you rate). The others stay
 * until you change them.
 *
 *   - Never is an exclusion rule (genre16Rule): the genre is gone.
 *   - Less / More / Much more are soft preferences carrying `genre16`, so they match exactly the titles Never on
 *     the same genre would hide. Step 3 multiplies a matching title's odds of making the feed by the weight
 *     (step3-soft-modifiers.ts), and a genre turned up never fills more than half a batch (turned-up-cap.ts).
 *
 * The weights are set by what a person sees, measured on simulated pools of 150 and 300 (the score is close to a
 * title's place in its pool): for a genre that is a quarter of the pool, Less leaves about half of its share of
 * the feed (25% → 11–13%), More about one and a half times (→ 36–41%), Much more about twice (→ 48–57%). The old
 * "Less of" (score × 0.5–0.7) took the same genre to 0–11%: in practice a Never.
 */
import type { ContextualLogic, ExclusionRule, SoftPreference } from '@/types/dna'
import { GENRES_16, GENRE_13_OF, type Genre16 } from '@/app/play/lib/genres16'
import { genre16Of, genre16Rule } from './exclusion-rules'

export const GENRE_CALLS = ['never', 'less', 'normal', 'more', 'much'] as const
export type GenreCall = (typeof GENRE_CALLS)[number]

/** Odds multipliers for the three soft steps. */
export const GENRE_CALL_WEIGHT = { less: 1 / 3, more: 2.5, much: 6 } as const

/** At or above this a stored weight reads as Much more (between More's 2.5 and Much more's 6). */
const MUCH_FROM = 4

const norm = (s: string) => s.trim().toLowerCase()

/**
 * Which of the 16 an older genre rule covers, by name: rules from chat and the season's genre step (update-from-play
 * NEVER_RULE_NAMES) name TMDB genres, which hide more than one of the 16. "science fiction" hides most superhero
 * films too; "animation" hides kids', adult and anime; "family" hides animated family films. A Never like that shows
 * on every genre it hides, so the page never says Normal on a genre the feed still hides.
 */
const NAME_COVERS: Record<string, Genre16[]> = {
  'comedy': ['comedy'], 'drama': ['drama'], 'action': ['action'], 'action & adventure': ['action'], 'crime': ['crime'],
  'thriller': ['thriller'], 'mystery': ['thriller'], 'science fiction': ['scifi', 'hero'], 'fantasy': ['fantasy', 'hero'],
  'sci-fi & fantasy': ['scifi', 'fantasy', 'hero'], 'horror': ['horror'], 'romance': ['romance'],
  'animation': ['adultanim', 'anim', 'anime'], 'anime': ['anime'], 'family': ['family', 'anim'], 'kids': ['family', 'anim'],
  'documentary': ['doc'], 'war': ['war'], 'history': ['war'], 'war & politics': ['war'],
}

function namedGenres(name: string): Genre16[] {
  const n = norm(name)
  const byLabel = GENRES_16.find(g => norm(g.label) === n)?.id
  return byLabel ? [byLabel] : NAME_COVERS[n] ?? []
}
/** The 16 a genre rule hides. */
function ruleCovers(r: ExclusionRule): Genre16[] {
  if (r.type !== 'genre') return []
  const g = genre16Of(r)
  return g ? [g] : namedGenres(r.name)
}
/** The one of the 16 a soft preference is about (a call from this page, or an older one naming a single genre). */
function prefGenre(p: SoftPreference): Genre16 | null {
  if (p.genre16) return GENRES_16.some(g => g.id === p.genre16) ? (p.genre16 as Genre16) : null
  if (p.target_type && p.target_type !== 'genre') return null
  const gs = namedGenres(p.signal)
  return gs.length === 1 ? gs[0] : null
}

/** The call on every one of the 16 genres, as the page shows it. A Never wins over a softer call on the same genre. */
export function genreCalls(logic: Pick<ContextualLogic, 'exclusion_rules' | 'soft_preferences'>): Record<Genre16, GenreCall> {
  const out = Object.fromEntries(GENRES_16.map(g => [g.id, 'normal'])) as Record<Genre16, GenreCall>
  for (const p of logic.soft_preferences) {
    const g = prefGenre(p)
    if (!g || !Number.isFinite(p.weight_modifier) || p.weight_modifier === 1) continue
    out[g] = p.weight_modifier < 1 ? 'less' : p.weight_modifier >= MUCH_FROM ? 'much' : 'more'
  }
  for (const r of logic.exclusion_rules) for (const g of ruleCovers(r)) out[g] = 'never'
  return out
}

/**
 * The rules with one genre's call set. Every rule and preference about that genre comes out (a Never from the genre
 * screen, the games or chat, an older "Less of"), then the new call goes in. An older rule that also hid other genres
 * ("science fiction" hid Superheroes too) is replaced by an exact Never on each of those, so changing one genre never
 * changes another. Returns a new object; the input is untouched.
 */
export function setGenreCall<T extends Pick<ContextualLogic, 'exclusion_rules' | 'soft_preferences'>>(
  logic: T, g: Genre16, call: GenreCall,
): T {
  const removed = logic.exclusion_rules.filter(r => ruleCovers(r).includes(g))
  const exclusion_rules = logic.exclusion_rules.filter(r => !removed.includes(r))
  const keep = (s: Genre16) => s !== g && !exclusion_rules.some(r => ruleCovers(r).includes(s))
  for (const s of new Set(removed.flatMap(ruleCovers))) if (keep(s)) exclusion_rules.push(genre16Rule(s))

  const soft_preferences = logic.soft_preferences.filter(p => prefGenre(p) !== g)
  if (call === 'never') exclusion_rules.push(genre16Rule(g))
  else if (call !== 'normal') {
    const label = GENRES_16.find(x => x.id === g)!.label
    soft_preferences.push({ signal: label, weight_modifier: GENRE_CALL_WEIGHT[call], target_type: 'genre', genre16: g })
  }
  return { ...logic, exclusion_rules, soft_preferences }
}

/** The 16 genres a preference turns up (weight above 1), for the half-batch cap. */
export function turnedUpGenres(prefs: SoftPreference[]): Genre16[] {
  return [...new Set(prefs.filter(p => p.weight_modifier > 1).map(prefGenre).filter((g): g is Genre16 => !!g))]
}

/**
 * The games' saved answers with one genre's Never taken back, or null when they don't hold one. The games re-sync
 * their Nevers into the DNA (update-from-play.ts), so a Never removed on the page must also leave the answers it came
 * from, or the next sync puts it back: the genre screen's answer on the 16, and the 13-genre value it wrote (a
 * season Never, or the genre screen's when every one of the 16 on that 13 was a Never). Any other genre that 13-genre
 * Never hid keeps an exact Never of its own (setGenreCall).
 */
export function releaseGameNever<S extends { gen?: Record<string, number>; onboarding?: { genres16?: Partial<Record<Genre16, string>> } }>(
  state: S, g: Genre16,
): S | null {
  const g13 = GENRE_13_OF[g]
  const said = state.onboarding?.genres16?.[g] === 'never'
  const games = (state.gen?.[g13] ?? 0) <= -5
  if (!said && !games) return null
  const next = structuredClone(state)
  if (said && next.onboarding?.genres16) delete next.onboarding.genres16[g]
  if (games && next.gen) next.gen[g13] = 0
  return next
}
