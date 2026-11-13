import { describe, it, expect } from 'vitest'
import { applyOdds, applySoftModifiers } from '@/modules/engine/pipeline/step3-soft-modifiers'
import { createBlankDNA } from '@/modules/dna/blank-dna'
import type { DNASchema } from '@/types/dna'
import type { ScoredTitle, TitleRow } from '@/modules/engine/types'

// P1-E4: step 3 keeps the soft preferences (DEC-6; on odds since P2-U8) and drops the chat-only temporal
// modifiers (DEC-5). Composites here are v2-shaped: pool percentiles in (0,1).

const item = (tmdb_id: string, composite: number, genres: string[], tone_tags: string[] = []): ScoredTitle => ({
  title: {
    tmdb_id, type: 'movie', title: tmdb_id, genres: genres.map(name => ({ name })), keywords: [],
    tone_tags, pacing_tag: 'slow_burn', original_language: 'en',
    crew: { directors: [], writers: [], cinematographers: [], cast: [] },
  } as unknown as TitleRow,
  composite_score: composite,
  soft_preferences_applied: [],
} as unknown as ScoredTitle)

const dnaWith = (edit: (d: DNASchema) => void) => { const d = createBlankDNA('u1'); edit(d); return d }

describe('step 3 — Less / More / Much more move a title\'s odds (P2-U8)', () => {
  it('multiplies the odds, not the score: 0.5 at a third is 0.25, at three is 0.75', () => {
    expect(applyOdds(0.5, 1 / 3)).toBeCloseTo(0.25, 12)
    expect(applyOdds(0.5, 3)).toBeCloseTo(0.75, 12)
    expect(applyOdds(0.9, 1)).toBeCloseTo(0.9, 12)
  })

  it('sinks a matching title without capping it: the best romance still beats a weaker crime', () => {
    const d = dnaWith(x => { x.contextual_logic.soft_preferences.push({ signal: 'romance', weight_modifier: 0.7 }) })
    const out = applySoftModifiers([item('rom', 0.95, ['Romance']), item('heist', 0.90, ['Crime']), item('rom2', 0.6, ['Romance'])], d)
    expect(out.map(s => s.title.tmdb_id)).toEqual(['rom', 'heist', 'rom2'])
    expect(out[0].composite_score).toBeCloseTo(applyOdds(0.95, 0.7), 12)
    expect(out[0].soft_preferences_applied).toEqual([{ signal: 'romance', modifier: 0.7 }])
    expect(out[1].soft_preferences_applied).toEqual([])
  })

  it('raises a turned-up genre, and keeps the score before it for the card', () => {
    const d = dnaWith(x => { x.contextual_logic.soft_preferences.push({ signal: 'Comedy', weight_modifier: 2.5, target_type: 'genre', genre16: 'comedy' }) })
    const out = applySoftModifiers([item('drama', 0.8, ['Drama']), item('com', 0.7, ['Comedy'])], d)
    expect(out.map(s => s.title.tmdb_id)).toEqual(['com', 'drama'])
    expect(out[0].match_score).toBe(0.7)
    expect(out[1].match_score).toBeUndefined()
  })

  it('a call on one of the 16 matches exactly that genre: More of Sci-fi leaves superhero films alone', () => {
    const d = dnaWith(x => { x.contextual_logic.soft_preferences.push({ signal: 'Sci-fi', weight_modifier: 6, target_type: 'genre', genre16: 'scifi' }) })
    const hero = { ...item('hero', 0.5, ['Science Fiction', 'Action']), }
    ;(hero.title as unknown as { keywords: string[] }).keywords = ['superhero']
    const out = applySoftModifiers([hero, item('space', 0.5, ['Science Fiction'])], d)
    expect(out.find(s => s.title.tmdb_id === 'space')!.composite_score).toBeCloseTo(applyOdds(0.5, 6), 12)
    expect(out.find(s => s.title.tmdb_id === 'hero')!.composite_score).toBe(0.5)
  })

  it('keeps the composite inside (0,1)', () => {
    const d = dnaWith(x => { x.contextual_logic.soft_preferences.push({ signal: 'romance', weight_modifier: 6 }) })
    const [s] = applySoftModifiers([item('rom', 0.999, ['Romance'])], d)
    expect(s.composite_score).toBeGreaterThan(0)
    expect(s.composite_score).toBeLessThan(1)
  })
})

describe('step 3 — the chat\'s "tonight" modifiers are gone', () => {
  it('ignores temporal_modifiers, even ones left in an old fingerprint', () => {
    const d = dnaWith(x => {
      x.contextual_logic.temporal_modifiers.push({ condition: 'tonight', boost: 'light', suppress: 'slow' })
    })
    const items = [item('a', 0.9, ['Drama'], ['light']), item('b', 0.8, ['Drama'], ['dark'])]
    const out = applySoftModifiers(items, d)
    expect(out.map(s => s.composite_score)).toEqual([0.9, 0.8])
    expect(out.every(s => s.soft_preferences_applied.length === 0)).toBe(true)
  })
})
