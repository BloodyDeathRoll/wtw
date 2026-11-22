import { describe, it, expect } from 'vitest'
import { createBlankDNA } from '@/modules/dna/blank-dna'
import { injectStretchPick } from '@/modules/engine/pipeline/step5-stretch-pick'
import { buildReasonPayloads } from '@/modules/engine/pipeline/step6-reason-payload'
import type { DNASchema } from '@/types/dna'
import type { ScoredTitle } from '@/modules/engine/types'

/** #416: the stretch pick shows for someone who only rates, on formula v2's sparse strand B. */

const title = (
  id: string,
  composite_score: number,
  external_rating_score: number,
  opts: { times_served?: number; complexity?: string } = {},
): ScoredTitle =>
  ({
    title: {
      tmdb_id: id, type: 'movie', title: `T${id}`, release_year: 2000,
      times_served: opts.times_served,
      narrative_metadata: opts.complexity ? { narrative_complexity: { value: opts.complexity } } : undefined,
    },
    composite_score,
    external_rating_score,
    crew_matches: [], lineage_connections: [], dimension_matches: [],
    soft_preferences_applied: [], groq_rationale: '',
    is_stretch_pick: false, stretch_rationale: null, dimensions_stretched: [],
  }) as unknown as ScoredTitle

/** The test account's shape (#416): 15 ratings, no chat session, strand B barely known. */
function rater(signals = 15): DNASchema {
  const dna = createBlankDNA('u1')
  dna.signals = Array.from({ length: signals }, (_, i) => ({ tmdb_id: `r${i}`, type: 'movie', reaction: 'liked' })) as unknown as DNASchema['signals']
  dna.metadata.total_sessions = 0
  dna.strand_b_narrative_dimensions.narrative_complexity = { value: 'high', confidence: 0.01, notes: '' }
  return dna
}

const ranked = Array.from({ length: 20 }, (_, i) => title(`k${i}`, 0.9, 0.8))
const ids = (list: ScoredTitle[]) => list.map(t => t.title.tmdb_id)

describe('step 5: stretch pick (#416)', () => {
  it('serves one to someone who rates but never chats, with strand B unsure', () => {
    const out = injectStretchPick(ranked, [...ranked, title('s1', 0.3, 0.85)], rater())
    expect(out).toHaveLength(20)
    expect(out[19].title.tmdb_id).toBe('s1')
    expect(out[19].is_stretch_pick).toBe(true)
    expect(out[19].stretch_rationale).toBe(
      'Intentional stretch: this title is outside what you usually go for. High critical rating. Accept or reject — both are useful signals.',
    )
    expect(ids(out.slice(0, 19))).toEqual(ids(ranked.slice(0, 19)))
  })

  it('still waits for 15 ratings', () => {
    const out = injectStretchPick(ranked, [...ranked, title('s1', 0.3, 0.85)], rater(14))
    expect(out).toBe(ranked)
  })

  it('keeps the bar: a low match and a high crowd score', () => {
    const pool = [...ranked, title('fits', 0.45, 0.9), title('weak', 0.2, 0.6)]
    expect(injectStretchPick(ranked, pool, rater())).toBe(ranked)
  })

  it('picks the least served first, so it changes between Refreshes', () => {
    const pool = [...ranked, title('old', 0.3, 0.95, { times_served: 2 }), title('new', 0.3, 0.75)]
    expect(injectStretchPick(ranked, pool, rater())[19].title.tmdb_id).toBe('new')
  })

  it('then prefers a strand B clash, naming it, then the better rated', () => {
    const dna = rater()
    dna.strand_b_narrative_dimensions.narrative_complexity = { value: 'high', confidence: 0.6, notes: '' }
    const pool = [...ranked, title('plain', 0.3, 0.95), title('clash', 0.3, 0.75, { complexity: 'low' })]
    const pick = injectStretchPick(ranked, pool, dna)[19]
    expect(pick.title.tmdb_id).toBe('clash')
    expect(pick.dimensions_stretched).toEqual(['narrative_complexity'])
    expect(pick.stretch_rationale).toContain('lower on your usual narrative complexity preferences')

    const unclashed = [...ranked, title('ok', 0.3, 0.75), title('best', 0.3, 0.95)]
    expect(injectStretchPick(ranked, unclashed, rater())[19].title.tmdb_id).toBe('best')
  })

  it('step 6 says it plainly when there is no strand B clash, on v1 too', () => {
    const [pick] = injectStretchPick([title('k0', 0.9, 0.8)], [title('s1', 0.3, 0.85)], rater())
    const [withPayload] = buildReasonPayloads([pick])
    expect(withPayload.reason_payload.negative_signals[0]).toBe(
      'A stretch pick: chosen on purpose from outside what you usually go for.',
    )
  })
})
