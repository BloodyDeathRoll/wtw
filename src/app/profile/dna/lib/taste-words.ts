/**
 * The words on the Taste DNA page (P2-U8), from facts only: what you rated and what the taste model learned.
 * Pure, so the page and its tests share them. Decided with Eran on the playable prototype
 * (docs/prototypes/taste-dna-v2/play.py), 2026-11-13.
 */
import { SCALE_LABELS, type TasteScale } from '@/app/play/lib/scales'
import { FEATURE_SCALES } from '@/lib/taste-scales/features'
import type { GenreCall } from '@/lib/genre-calls'

export type Reaction3 = 'loved' | 'liked' | 'disliked'
export interface Tally { loved: number; liked: number; disliked: number }

/** What your ratings say about a genre, under its name. `thin` = too little to go on (shown quieter). */
export function genreSays(t: Tally, call: GenreCall): { text: string; thin: boolean } {
  const n = t.loved + t.liked + t.disliked
  if (!n) return { text: call === 'never' ? 'Hidden from your feed' : 'Nothing rated yet', thin: true }
  if (n < 3) return { text: `Only ${n} rated so far`, thin: true }
  if (t.loved === n) return { text: `Loved all ${n}`, thin: false }
  if (!t.disliked) return { text: `Enjoyed all ${n}`, thin: false }
  const s = t.disliked / n
  if (s <= 0.25) return { text: `Mostly enjoyed · ${n} titles`, thin: false }
  if (s >= 0.6) return { text: `Mostly disliked · ${n} titles`, thin: false }
  return { text: `Mixed · ${n} titles`, thin: false }
}

/** The line under a genre's five steps, in the person's own voice. */
export const CALL_SAYS: Record<GenreCall, (g: string) => string> = {
  never: g => `I never want to see ${g} in my feed.`,
  less: g => `I want to see less ${g} in my feed.`,
  normal: g => `Let my ratings decide how much ${g} I see.`,
  more: g => `I want to see more ${g} in my feed.`,
  much: g => `I want to see a lot more ${g} in my feed.`,
}
export const CALL_STAYS = (c: GenreCall) => (c === 'normal' ? 'The more you rate, the better it gets.' : 'Stays until you change it.')

// ── The scales ────────────────────────────────────────────────────────────────

/** The model's weight that reads as a full lean (the season's AxisRow scale, ±1). */
const FULL_LEAN = 0.4
/** Rated titles that sit clearly on a scale before the page is sure of your lean on it. */
const SURE_AT = 8

export interface ScaleRow { id: TasteScale; left: string; right: string; lean: number; sure: number; clear: boolean }

/**
 * One row per scale, clear leans first (strongest first), the rest after, faded. Dry wit / silly only once five
 * comedies are rated, mini-series / long haul once five series are: before that the model has nothing to go on.
 */
export function scaleRows(
  w: number[],
  rated: { scales: Partial<Record<TasteScale, number>> | null; comedy: boolean; series: boolean }[],
): ScaleRow[] {
  const ids: TasteScale[] = [...FEATURE_SCALES, 'audience']
  const comedies = rated.filter(r => r.comedy).length, series = rated.filter(r => r.series).length
  return ids
    .filter(s => !(s === 'humor' && comedies < 5) && !(s === 'commit' && series < 5))
    .map(s => {
      const i = 14 + ids.indexOf(s)   // [14..23] the ten scales, [24] audience (features.ts)
      const lean = Math.max(-1, Math.min(1, (w[i] ?? 0) / FULL_LEAN))
      const sure = Math.min(1, rated.filter(r => Math.abs(r.scales?.[s] ?? 0) >= 0.5).length / SURE_AT)
      return { id: s, left: SCALE_LABELS[s][0], right: SCALE_LABELS[s][1], lean, sure, clear: sure > 0.35 && Math.abs(lean) > 0.25 }
    })
    .sort((a, b) => Number(b.clear) - Number(a.clear) || Math.abs(b.lean) - Math.abs(a.lean))
}

// ── "In short" ────────────────────────────────────────────────────────────────

/** How a scale's ends read in "You go for … stories". Dry wit, length and audience don't read that way. */
const STORY_WORDS: Partial<Record<TasteScale, [string, string]>> = {
  tone: ['serious', 'funny'], energy: ['talky', 'action-packed'], pace: ['slow-burning', 'fast'], dark: ['light', 'dark'],
  complex: ['easy-to-follow', 'twisty'], fantastic: ['down-to-earth', 'otherworldly'], modern: ['classic', 'recent'],
  indie: ['mainstream', 'off-beat'],
}

export function crowdWords(w0: number): string {
  return w0 >= 0.3 ? 'You tend to love what everybody loves' : w0 >= 0.1 ? 'You’re sometimes with the crowd, sometimes not' : 'You don’t go by popularity'
}

/**
 * "You go for funny, light stories, with crime above all. You tend to love what everybody loves, and anything
 * Quentin Tarantino makes." Null until two scales lean clearly: then there is nothing true to say yet.
 */
export function summary(
  scales: ScaleRow[],
  genres: { label: string; tally: Tally }[],
  w0: number,
  topPerson: string | null,
): string | null {
  const leans = scales.filter(s => s.clear && STORY_WORDS[s.id]).map(s => STORY_WORDS[s.id]![s.lean > 0 ? 1 : 0])
  if (leans.length < 2) return null
  let best: { key: [number, number]; label: string } | null = null
  for (const g of genres) {
    const n = g.tally.loved + g.tally.liked + g.tally.disliked
    if (n < 5) continue
    const key: [number, number] = [(g.tally.loved + g.tally.liked) / n, n]
    if (!best || key[0] > best.key[0] || (key[0] === best.key[0] && key[1] > best.key[1])) best = { key, label: g.label.toLowerCase() }
  }
  let s = `You go for ${leans[0]}, ${leans[1]} stories` + (best ? `, with ${best.label} above all` : '') + '. ' + crowdWords(w0)
  s += topPerson ? `, and anything ${topPerson} makes.` : '.'
  return s
}
