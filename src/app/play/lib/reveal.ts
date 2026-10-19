/**
 * The season's reveal (step 15), in three tones set by the final round's
 * score (mock-ups approved 2026-10-19, docs/prototypes/reveal/f-*.jpg):
 *
 *   - high (7/10 or better): "You did it! 🎉", a one-time confetti drop
 *   - mid (4–6): "Season 1, done", warm and honest, no confetti
 *   - low (0–3): "You stumped me 🕵️", owns the miss, still a way forward
 *
 * The viewer name and its ticked lines only appear when the brain really
 * reads the player (`readsYou`); otherwise the headline states facts the
 * player gave it (their genres). Never "Still a bit of a mystery" over
 * confident lines.
 */
import { GAME_GENRES } from './genres'
import { canHunch, est, rankedScales, readsYou, SAY, viewerName, type PlayState } from './brain'

export type RevealTier = 'high' | 'mid' | 'low'

export interface Reveal {
  tier: RevealTier
  yay: string
  eyebrow: string
  headline: string
  /** Ticked lines: only with a viewer name. */
  ticks: string[]
  /** A plain sentence instead of ticks, when there's no name. */
  note: string | null
  score: number | null
  of: number
  cta: string
  confetti: boolean
}

/** Saves from before 2026-10-18 had a 5-pick final round. */
export function revealTier(score: number | undefined, of: number): RevealTier {
  if (score === undefined) return 'mid'
  const r = score / Math.max(1, of)
  return r >= 0.7 ? 'high' : r >= 0.4 ? 'mid' : 'low'
}

const genreWord = (id: string) => GAME_GENRES.find(g => g.id === id)!.label.toLowerCase().replace(/ & /g, ' and ')

/**
 * "Drama, comedy & a soft spot for action": what the player told us at setup,
 * loves first. Uses `loved` (saved at setup), since `gen` drifts with picks;
 * saves without it fall back to the setup values (love = 2, like = 1).
 */
export function factHeadline(S: PlayState): string {
  const sel = S.sel ?? []
  const loved = S.loved ?? sel.filter(g => (S.gen[g] ?? 0) >= 2)
  const liked = sel.filter(g => !loved.includes(g))
  const L = loved.map(genreWord), K = liked.map(genreWord)
  const cap = (s: string) => s[0].toUpperCase() + s.slice(1)
  const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} & ${xs[xs.length - 1]}` : xs[0])
  if (L.length >= 3) return cap(list(L.slice(0, 3)))
  if (L.length === 2) return K.length ? `${cap(L[0])}, ${L[1]} & a soft spot for ${K[0]}` : cap(list(L))
  if (L.length === 1) return K.length ? `${cap(L[0])}, with a soft spot for ${K[0]}` : `${cap(L[0])}, first and foremost`
  if (K.length) return `${cap(list(K.slice(0, 3)))}, mostly`
  return 'A bit of everything'
}

/** Up to three ticked lines: what the player told us, then the brain's clearest reads. */
export function revealTicks(S: PlayState): string[] {
  const auto = canHunch(S) ? rankedScales(S).slice(0, 3).filter(r => r.s > 0.12).map(r => SAY[r.a][est(S, r.a) > 0 ? 1 : 0]) : []
  return [...new Set([...S.truths, ...auto])].slice(0, 3)
}

export function revealOf(S: PlayState): Reveal {
  const of = S.showdownN ?? 5
  const score = S.showdownScore ?? null
  const tier = revealTier(S.showdownScore, of)
  const name = readsYou(S) ? viewerName(S) : null
  const ticks = name ? revealTicks(S) : []
  const learning = `That's what you told me, and what you picked. Rate your picks and I'll sharpen up fast.`
  if (tier === 'low') {
    return {
      tier, score, of, ticks: [], confetti: false,
      yay: 'You stumped me 🕵️',
      eyebrow: 'Season 1, done',
      headline: score === 0 ? `I didn't call a single one of your ${of}` : `I called just ${score} of your ${of}`,
      note: 'Either your taste changes with your mood, or I\'ve been reading you wrong. Both are fixable. Rate your picks, even the ones you\'ve already seen, and we\'ll get there together.',
      cta: 'Let\'s try my picks',
    }
  }
  if (tier === 'high') {
    return {
      tier, score, of, ticks, confetti: true,
      yay: 'You did it! 🎉',
      eyebrow: name ? '15 steps later, I know who you are' : 'My first read on you',
      headline: name ?? factHeadline(S),
      note: name ? null : learning,
      cta: 'Bring on my picks 🍿',
    }
  }
  return {
    tier, score, of, ticks, confetti: false,
    yay: 'Season 1, done',
    eyebrow: name ? '15 steps later, here\'s my read' : 'My first read on you',
    headline: name ?? factHeadline(S),
    note: name ? null : `That's what you told me, and what you picked. I called ${score ?? '–'} of your ${of} final-round picks, so I'm still learning the rest. Rate your picks and I'll sharpen up fast.`,
    cta: 'Bring on my picks 🍿',
  }
}
