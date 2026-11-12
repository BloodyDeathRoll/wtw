import { describe, it, expect } from 'vitest'
import { buildReasonPayloads } from '@/modules/engine/pipeline/step6-reason-payload'
import { normalCdf } from '@/modules/engine/scoring/formula-v2'
import type { ScoredTitle } from '@/modules/engine/types'

// P1-E5: step 6 under formula v2 — the sheet's three bars, "What it's like",
// and the reasons against from the model and the crowd.

const base = (over: Partial<ScoredTitle> = {}): ScoredTitle => ({
  title: { tmdb_id: '1', type: 'movie', title: 'T', genres: [], tone_tags: [], pacing_tag: 'slow_burn', original_language: 'fr',
    crew: { directors: [], writers: [], cinematographers: [], cast: [] }, tmdb_rating: 7, omdb_rating: null } as never,
  crew_affinity_score: 0.5, narrative_match_score: 0.1, visceral_match_score: 0.1, content_affinity_score: 0.5,
  content_avoided: null, external_rating_score: 0.4, recency_boost: 0, composite_score: 0.5,
  crew_matches: [], lineage_connections: [], dimension_matches: [], soft_preferences_applied: [],
  groq_rationale: '', is_stretch_pick: false, stretch_rationale: null, dimensions_stretched: [],
  ...over,
})

// dark is input 16, crime 5
const vec = new Array(25).fill(0); vec[16] = 0.8; vec[5] = 1
const contributions = new Array(25).fill(0); contributions[16] = -0.3

describe('step 6 — v1 (no formula_v2) is unchanged', () => {
  it('keeps the old reasons against and adds no taste field', () => {
    const [p] = buildReasonPayloads([base()])
    expect(p.reason_payload.taste).toBeUndefined()
    expect(p.reason_payload.negative_signals.join(' ')).toMatch(/Narrative dimensions/)
  })
})

describe('step 6 — formula v2', () => {
  const v2 = { z_creators: 0.5, z_crowd: -1.3, z_model: -0.8, model_score: -0.4, s: -0.5, composite: 0.3, pool_size: 300, vec, contributions }

  it('carries the three bars, each Φ(z), and what it is like', () => {
    const [p] = buildReasonPayloads([base({ formula_v2: v2 })])
    expect(p.reason_payload.taste).toEqual({
      bars: { taste: normalCdf(-0.8), crowd: normalCdf(-1.3), creators: normalCdf(0.5) },
      like: [
        { dimension: 'feel', value: 'dark' },
        { dimension: 'genre', value: 'crime' },
        { dimension: 'language', value: 'fr' },
      ],
    })
  })

  it('reasons against come from the model and the crowd, not narrative or visceral', () => {
    const [p] = buildReasonPayloads([base({ formula_v2: v2 })])
    const neg = p.reason_payload.negative_signals
    expect(neg).toContain("It's darker than you usually go for.")
    expect(neg).toContain('Rated lower than what you usually pick.')
    expect(neg.join(' ')).not.toMatch(/Narrative dimensions|Pacing|Tone differs/)
  })

  it('a title with no vector yet still gets its bars, and nothing about what it is like', () => {
    const [p] = buildReasonPayloads([base({ formula_v2: { ...v2, vec: undefined, contributions: undefined, model_score: null, z_model: 0 } })])
    expect(p.reason_payload.taste?.bars?.taste).toBe(0.5)
    expect(p.reason_payload.taste?.like).toEqual([])
  })

  it('a pool too small to compare carries no bars', () => {
    const [p] = buildReasonPayloads([base({ formula_v2: { ...v2, pool_size: 1 } })])
    expect(p.reason_payload.taste?.bars).toBeUndefined()
  })
})

describe('step 6 — a catch most of the batch shares (Eran, #272)', () => {
  const v2 = { z_creators: 0, z_crowd: 0, z_model: -0.8, model_score: -0.4, s: -0.5, composite: 0.3, pool_size: 300, vec, contributions }
  it('is left out of every title that has it, and marked for the writer', () => {
    const items = Array.from({ length: 30 }, (_, i) => base({ title: { ...base().title, tmdb_id: String(i) } as never, formula_v2: v2 }))
    const out = buildReasonPayloads(items)
    expect(out.every(p => p.reason_payload.taste?.catch_shared === true)).toBe(true)
    expect(out.every(p => !p.reason_payload.negative_signals.includes("It's darker than you usually go for."))).toBe(true)
  })
})

describe('step 6 — stretch picks under v2 say it plainly', () => {
  it('no v1 dimension names', () => {
    const v2 = { z_creators: 0, z_crowd: 0, z_model: 0, model_score: 0, s: 0, composite: 0.3, pool_size: 300 }
    const [p] = buildReasonPayloads([base({ formula_v2: v2, is_stretch_pick: true, dimensions_stretched: ['narrative_complexity'] })])
    expect(p.reason_payload.negative_signals[0]).toBe('A stretch pick: chosen on purpose from outside what you usually go for.')
    expect(p.reason_payload.negative_signals.join(' ')).not.toMatch(/narrative complexity/)
  })
})
