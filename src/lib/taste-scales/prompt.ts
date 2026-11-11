/**
 * The AI's instructions for scoring titles on the taste scales — one shared
 * copy for the season builder (scripts/build-play-titles.mts) and the
 * catalogue scorer (P1-D2). Moved verbatim from build-play-titles.mts
 * (docs/plan/PLAN.md, P1-D1); the catalogue adds the `audience` scale.
 */
import { z } from 'zod'

import { GAME_GENRE_IDS, type GameGenre } from '@/app/play/lib/genres'

/** What a title line needs: a catalogue row plus its game genres split by certainty (`candidateGenres`). */
export interface PromptTitle {
  title: string
  type: 'movie' | 'tv'
  release_year: number | null
  genres: { name: string }[] | null
  keywords: string[] | null
  synopsis: string | null
  firm: GameGenre[]
  hinted: GameGenre[]
}

const score = z.number().int().min(-5).max(5)
const titleScores = z.object({
  n: z.number().int().describe('The number of the title in the list'),
  tone: score, energy: score, pace: score, dark: score, complex: score, fantastic: score,
  humor: score.nullable().describe('Only for titles marked COMEDY; null otherwise'),
  confirmed_genres: z.array(z.enum(GAME_GENRE_IDS as [GameGenre, ...GameGenre[]]))
    .describe('Which of the title\'s "Check genres" are a main genre of it; empty if none or none listed'),
})
export const batchSchema = z.object({ titles: z.array(titleScores) })
/** The catalogue's schema: the season's plus `audience`. */
export const catalogueBatchSchema = z.object({ titles: z.array(titleScores.extend({ audience: score })) })

export const SCALE_GUIDE = `Score each title on every scale from -5 to +5 (0 = middle). Judge the title itself as most viewers experience it, not its genre label.
- tone: -5 deadly serious ... +5 a comedy first and foremost
- energy: -5 driven by conversation and character ... +5 driven by action, fights, chases, set pieces
- pace: -5 slow burn, patient ... +5 fast, relentless
- dark: -5 light, warm, feel-good ... +5 bleak, disturbing, violent, morally grim. Tense or serious is NOT automatically dark.
- complex: -5 easy, switch-off viewing ... +5 a puzzle: non-linear, layered, demands attention
- fantastic: -5 grounded real world ... +5 another world: sci-fi, fantasy, supernatural, animation worlds
- humor (COMEDY titles only, else null): -5 silly, slapstick, broad ... +5 dry, deadpan, ironic wit

Reference points (tone, energy, pace, dark, complex, fantastic, humor):
- Friends (series): +5, -4, +2, -4, -4, -4, -2
- The Dark Knight: -3, +4, +3, +3, +1, +1, null
- Schindler's List: -5, -1, -3, +5, 0, -5, null
- Inception: -2, +3, +2, +1, +5, +3, null
- Shrek: +4, +1, +2, -3, -3, +4, -2
- Fleabag (series): +3, -5, +2, +1, +1, -4, +5
- The Notebook: -2, -4, -2, -2, -3, -4, null
- Mad Max: Fury Road: -2, +5, +5, +2, -2, +3, null

Use the whole range across the list; don't put everything near 0.`

/** The catalogue's guide: the season's plus `audience`, with the reference points of the T2 test. */
export const CATALOGUE_SCALE_GUIDE = `${SCALE_GUIDE}

Also score every title on audience:
- audience: -5 made for young children (preschool) ... 0 for everyone, all ages equally ... +5 strictly for adults (mature themes, violence, sex, language, adult humour). Animation is not automatically for kids.

Reference points (audience): Peppa Pig (series) -5, Frozen -3, Toy Story -2, Spirited Away -1, The Lord of the Rings: The Fellowship of the Ring +1, The Dark Knight +2, BoJack Horseman (series) +4, South Park (series) +4, The Wolf of Wall Street +5.`

export function titleLine(c: PromptTitle, n: number): string {
  const comedy = c.firm.includes('comedy') ? ' COMEDY' : ''
  const genres = (c.genres ?? []).map(g => g.name).join(', ')
  const keywords = (c.keywords ?? []).slice(0, 8).join(', ')
  const check = c.hinted.length ? `\n   Check genres: ${c.hinted.join(', ')}` : ''
  const plot = (c.synopsis ?? '').slice(0, 400)
  return `${n}. "${c.title}" (${c.release_year ?? '?'}, ${c.type === 'tv' ? 'series' : 'movie'})${comedy}
   TMDB genres: ${genres || 'none'}. Keywords: ${keywords || 'none'}${check}
   Plot: ${plot}`
}

/** The whole request for one batch: a scale guide (SCALE_GUIDE or CATALOGUE_SCALE_GUIDE) and the numbered titles. */
export function batchPrompt(guide: string, titles: PromptTitle[]): string {
  return `${guide}

"Check genres" uses these ids: thriller = thriller or mystery, war = war or history, horror, romance, action. Confirm one only if it is truly a main genre of the title, not a side element.

Titles:
${titles.map((c, i) => titleLine(c, i + 1)).join('\n')}

Return one entry per title, with n matching its number.`
}

/**
 * A near-miss (a 6, a 2.5, a genre id outside the list) shouldn't waste the
 * call: clamp and round the numbers, drop unknown genres, parse again.
 */
export function repairBatch<S extends typeof batchSchema | typeof catalogueBatchSchema = typeof batchSchema>(
  err: unknown,
  schema: S = batchSchema as S,
): z.infer<S> | null {
  const text = (err as { text?: unknown }).text
  if (typeof text !== 'string') return null
  let raw: { titles?: Record<string, unknown>[] }
  try { raw = JSON.parse(text) } catch { return null }
  if (!Array.isArray(raw.titles)) return null
  const fix = (v: unknown) => typeof v === 'number' ? Math.max(-5, Math.min(5, Math.round(v))) : v
  for (const t of raw.titles) {
    for (const k of ['tone', 'energy', 'pace', 'dark', 'complex', 'fantastic', 'humor', 'audience']) if (k in t) t[k] = fix(t[k])
    if (t.humor === undefined) t.humor = null
    t.confirmed_genres = Array.isArray(t.confirmed_genres)
      ? t.confirmed_genres.filter(g => (GAME_GENRE_IDS as readonly unknown[]).includes(g))
      : []
  }
  const parsed = schema.safeParse(raw)
  if (parsed.success) {
    console.warn('[play-titles] repaired an off-schema batch')
    return parsed.data as z.infer<S>
  }
  console.warn(`[play-titles] unrepairable: ${JSON.stringify(parsed.error.issues[0]).slice(0, 200)}`)
  return null
}
