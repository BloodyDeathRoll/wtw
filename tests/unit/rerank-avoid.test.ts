import { describe, it, expect } from 'vitest'
import { avoidSummary } from '@/modules/engine/pipeline/step4-llm-rerank'
import { narrativeToEmbeddingText } from '@/modules/engine/enrichment/enrich-title-narrative'
import { applyContentAffinityUpdate } from '@/modules/dna/lib/update-content-affinity'
import { createBlankDNA } from '@/modules/dna/blank-dna'
import type { DNASchema, Reaction } from '@/types/dna'
import type { NarrativeExtractionResult } from '@/modules/engine/types'

// 2026-09-06: the rerank prompt was an entirely positive profile, so a model
// with no idea the user had said "no anime" five times could put one at the
// top of the batch on tonal resonance alone.

const dnaWith = (edit: (d: DNASchema) => void): DNASchema => {
  const d = createBlankDNA('u1')
  edit(d)
  return d
}

const rate = (d: DNASchema, n: number, reaction: Reaction, genres: string[], language = 'en') => {
  for (let i = 0; i < n; i++) {
    applyContentAffinityUpdate(
      d.strand_c_visceral_specs,
      { type: 'movie', genres: genres.map(name => ({ name })), original_language: language },
      reaction,
    )
  }
}

describe('rerank prompt — what the viewer avoids', () => {
  it('says nothing when there is nothing to say', () => {
    expect(avoidSummary(createBlankDNA('u1'))).toBe('')
  })

  it('names the hard rules', () => {
    const d = dnaWith(x => {
      x.contextual_logic.exclusion_rules.push(
        { type: 'keyword', id: '', name: 'anime', raw: 'no anime', reason: '' },
        { type: 'genre', id: '', name: 'horror', raw: 'no horror', reason: '' },
      )
    })
    expect(avoidSummary(d)).toContain('NEVER wants: anime, horror.')
  })

  it('names the hedges, strongest reduction first', () => {
    const d = dnaWith(x => {
      x.contextual_logic.soft_preferences.push(
        { signal: 'romance', weight_modifier: 0.5 },
        { signal: 'musicals', weight_modifier: 0.2 },
      )
    })
    expect(avoidSummary(d)).toContain('Wants less of: musicals, romance.')
  })

  it('leaves out a preference that is not a reduction', () => {
    const d = dnaWith(x => {
      x.contextual_logic.soft_preferences.push({ signal: 'westerns', weight_modifier: 1 })
    })
    expect(avoidSummary(d)).toBe('')
  })

  it('reports what the user rated down without ever saying so', () => {
    const d = dnaWith(x => rate(x, 27, 'disliked', ['Animation'], 'ja'))
    const s = avoidSummary(d)
    expect(s).toContain('Has repeatedly rated down:')
    expect(s).toContain('animation (27 rated down)')
    expect(s).toContain('ja (27 rated down)')
  })

  it('ranks the best-evidenced dislikes first, across both buckets', () => {
    // Two bugs live here. Concatenating two per-bucket-sorted lists and
    // slicing the front dropped every language once five genres were
    // disliked. And ranking by score alone cannot break the tie: every
    // always-disliked entry converges on the same -0.20 whether it was rated
    // 3 times or 40, so confidence is what separates them.
    const d = dnaWith(x => {
      for (const g of ['Horror', 'Western', 'Musical', 'Documentary', 'Reality', 'Soap']) {
        rate(x, 3, 'disliked', [g], 'en')
      }
      rate(x, 30, 'disliked', ['Drama'], 'ja') // far better evidenced
    })
    const s = avoidSummary(d)

    expect(s).toContain('ja (30 rated down)')
    // The thinly-evidenced genres lose their places to the well-evidenced ones.
    expect(s).not.toContain('soap')
  })

  it('does not report a genre the user likes', () => {
    const d = dnaWith(x => rate(x, 20, 'loved', ['Drama']))
    expect(avoidSummary(d)).toBe('')
  })

  it('works on a fingerprint written before content affinity existed', () => {
    const d = dnaWith(x => {
      delete x.strand_c_visceral_specs.genre_affinity
      delete x.strand_c_visceral_specs.language_affinity
      x.contextual_logic.exclusion_rules.push({ type: 'keyword', id: '', name: 'anime', raw: '', reason: '' })
    })
    expect(avoidSummary(d)).toBe('NEVER wants: anime.')
  })
})

describe('title embedding text — tone vocabulary', () => {
  const meta = (tone_tags: string[]): NarrativeExtractionResult => ({
    pacing_tag: 'moderate',
    tone_tags,
    narrative_metadata: {
      moral_ambiguity:      { value: 'medium', confidence: 0.8 },
      narrative_complexity: { value: 'medium', confidence: 0.8 },
      emotional_demand:     { value: 'medium', confidence: 0.8 },
      originality_weight:   { value: 0.5, confidence: 0.8 },
      humor_style:          { value: 'none', confidence: 0.8 },
      protagonist_type:     { value: 'everyman', confidence: 0.8 },
      ensemble_vs_solo:     { value: 'neutral', confidence: 0.8 },
    },
  })

  it('states the tones when there are any', () => {
    expect(narrativeToEmbeddingText(meta(['dark', 'cynical']))).toContain('Tone: dark, cynical.')
  })

  it('omits the line entirely when no tone dominates', () => {
    const text = narrativeToEmbeddingText(meta([]))
    expect(text).not.toContain('Tone:')
    expect(text).toContain('Pacing: moderate.')
    expect(text).toContain('Moral ambiguity: medium.')
  })
})
