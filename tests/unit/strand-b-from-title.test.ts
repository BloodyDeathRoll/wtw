import { describe, it, expect } from 'vitest'
import { applyStrandBFromTitle } from '@/modules/dna/lib/update-strand-b-from-title'
import { createBlankDNA } from '@/modules/dna/blank-dna'
import type { StrandB } from '@/types/dna'

// Card ratings now teach strand B from the title's own narrative_metadata.
// 2026-08-28: 250 ratings had left every dimension at its blank default.

const blank = (): StrandB => createBlankDNA('u').strand_b_narrative_dimensions
const tag = (value: unknown, confidence = 0.9) => ({ value, confidence })

describe('applyStrandBFromTitle', () => {
  it('reinforces a matching value on a loved title', () => {
    const b = blank()
    applyStrandBFromTitle(b, { moral_ambiguity: tag('medium') }, 'loved')
    expect(b.moral_ambiguity.value).toBe('medium')
    expect(b.moral_ambiguity.confidence).toBeCloseTo(0.054)
  })

  it('adopts a different value once the old one is out-voted', () => {
    const b = blank()
    b.moral_ambiguity = { value: 'medium', confidence: 0.1, notes: '' }
    applyStrandBFromTitle(b, { moral_ambiguity: tag('high') }, 'loved') // 0.1 - 0.054 = 0.046
    expect(b.moral_ambiguity.value).toBe('medium')
    applyStrandBFromTitle(b, { moral_ambiguity: tag('high') }, 'loved') // → 0 → adopt
    expect(b.moral_ambiguity.value).toBe('high')
    expect(b.moral_ambiguity.confidence).toBeCloseTo(0.2)
  })

  it('a dislike only weakens a matching value, never adopts', () => {
    const b = blank()
    b.humor_style = { value: 'dry', confidence: 0.5, notes: '' }
    applyStrandBFromTitle(b, { humor_style: tag('dry') }, 'disliked')
    expect(b.humor_style.value).toBe('dry')
    expect(b.humor_style.confidence).toBeCloseTo(0.5 - 0.036)
    applyStrandBFromTitle(b, { humor_style: tag('slapstick') }, 'disliked')
    expect(b.humor_style.value).toBe('dry')
    expect(b.humor_style.confidence).toBeCloseTo(0.5 - 0.036) // unchanged
  })

  it('moves a numeric dimension toward a loved title and away from a disliked one', () => {
    const b = blank() // originality 0.5
    applyStrandBFromTitle(b, { originality_weight: tag(1.0, 1) }, 'loved')
    expect(b.originality_weight.value).toBeCloseTo(0.5 + 0.5 * 0.06 * 2)
    const after = b.originality_weight.value as number
    applyStrandBFromTitle(b, { originality_weight: tag(1.0, 1) }, 'disliked')
    expect(b.originality_weight.value).toBeLessThan(after)
  })

  it('ignores low-confidence and missing tags', () => {
    const b = blank()
    const touched = applyStrandBFromTitle(b, { moral_ambiguity: tag('high', 0.2), humor_style: undefined }, 'loved')
    expect(touched).toBe(0)
    expect(b.moral_ambiguity).toEqual(blank().moral_ambiguity)
  })

  it('never lets a malformed tag poison a dimension with NaN', () => {
    const b = blank()
    applyStrandBFromTitle(b, { moral_ambiguity: { value: 'high', confidence: 'high' as unknown as number } }, 'loved')
    applyStrandBFromTitle(b, { originality_weight: { value: Number.NaN, confidence: 1 } }, 'loved')
    expect(Number.isFinite(b.moral_ambiguity.confidence)).toBe(true)
    expect(b.moral_ambiguity.value).toBe('medium')
    expect(Number.isFinite(b.originality_weight.value as number)).toBe(true)
  })

  it('ignores a value outside the enrichment enum instead of writing it verbatim', () => {
    const b = blank()
    const touched = applyStrandBFromTitle(b, { humor_style: tag('sardonic'), protagonist_type: tag('chosen_one') }, 'loved')
    expect(touched).toBe(0)
    expect(b.humor_style.value).toBe('none')
    expect(b.protagonist_type.value).toBe('everyman')
  })

  it('is a no-op without metadata', () => {
    const b = blank()
    expect(applyStrandBFromTitle(b, null, 'loved')).toBe(0)
  })
})

// 2026-10-16: originality confidence rose on every positive reaction, agreeing
// or not, and sat at 100% for 3 of 4 active users.
describe('applyStrandBFromTitle — originality confidence', () => {
  const withOriginality = (value: number, confidence: number) => {
    const b = blank()
    b.originality_weight = { value, confidence, notes: '' }
    return b
  }

  it('rises when a liked title agrees with the current value', () => {
    const b = withOriginality(0.6, 0.5)
    applyStrandBFromTitle(b, { originality_weight: tag(0.65, 1) }, 'loved')
    expect(b.originality_weight.confidence).toBeCloseTo(0.56)
  })

  it('falls when a liked title disagrees, while the value still moves toward it', () => {
    const b = withOriginality(0.6, 0.5)
    applyStrandBFromTitle(b, { originality_weight: tag(0.1, 1) }, 'loved')
    expect(b.originality_weight.confidence).toBeCloseTo(0.44)
    expect(b.originality_weight.value as number).toBeLessThan(0.6)
  })

  it('falls when a disliked title agrees with the current value', () => {
    const b = withOriginality(0.6, 0.5)
    applyStrandBFromTitle(b, { originality_weight: tag(0.6, 1) }, 'disliked')
    expect(b.originality_weight.confidence).toBeCloseTo(0.46)
  })

  it('is untouched by a disliked title far from the current value', () => {
    const b = withOriginality(0.6, 0.5)
    applyStrandBFromTitle(b, { originality_weight: tag(0.1, 1) }, 'disliked')
    expect(b.originality_weight.confidence).toBe(0.5)
  })

  it('does not saturate when liked titles agree and disagree in turn', () => {
    const b = withOriginality(0.6, 0.5)
    for (let i = 0; i < 100; i++) {
      const current = b.originality_weight.value as number
      // Agreeing tags hug the current value; disagreeing ones sit far off and
      // are re-centred on it so the value can't drift into "agree" range.
      const value = i % 2 ? current + 0.05 : (current > 0.5 ? current - 0.5 : current + 0.5)
      applyStrandBFromTitle(b, { originality_weight: tag(value, 1) }, 'liked')
    }
    expect(b.originality_weight.confidence).toBeGreaterThan(0)
    expect(b.originality_weight.confidence).toBeLessThan(1)
  })

  it('treats a gap of exactly AGREE_GAP (0.15) as agreeing', () => {
    // 0.16 - 0.01 is exactly 0.15 in floating point; most pairs are not.
    const b = withOriginality(0.01, 0.5)
    applyStrandBFromTitle(b, { originality_weight: tag(0.16, 1) }, 'loved')
    expect(b.originality_weight.confidence).toBeCloseTo(0.56)
  })
})
