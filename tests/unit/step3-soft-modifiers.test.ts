import { describe, it, expect } from 'vitest'
import { applySoftModifiers } from '@/modules/engine/pipeline/step3-soft-modifiers'
import { createBlankDNA } from '@/modules/dna/blank-dna'
import type { DNASchema } from '@/types/dna'
import type { ScoredTitle, TitleRow } from '@/modules/engine/types'

// P1-E4: step 3 keeps "Less of" (DEC-6) and drops the chat-only temporal
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

describe('step 3 — "Less of" under formula v2', () => {
  it('sinks a matching title by its modifier and re-sorts', () => {
    const d = dnaWith(x => { x.contextual_logic.soft_preferences.push({ signal: 'romance', weight_modifier: 0.7 }) })
    const out = applySoftModifiers([item('rom', 0.95, ['Romance']), item('heist', 0.90, ['Crime'])], d)
    expect(out.map(s => s.title.tmdb_id)).toEqual(['heist', 'rom'])
    expect(out[1].composite_score).toBeCloseTo(0.95 * 0.7, 12)
    expect(out[1].soft_preferences_applied).toEqual([{ signal: 'romance', modifier: 0.7 }])
    expect(out[0].soft_preferences_applied).toEqual([])
  })

  it('keeps the composite inside (0,1)', () => {
    const d = dnaWith(x => { x.contextual_logic.soft_preferences.push({ signal: 'romance', weight_modifier: 0.7 }) })
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
