import { describe, it, expect } from 'vitest'
import { createBlankDNA } from '@/modules/dna/blank-dna'
import { unrateInDNA } from '@/modules/dna/unrate'
import { applyCrewAffinityUpdate } from '@/modules/dna/lib/update-crew'
import { applyContentAffinityUpdate } from '@/modules/dna/lib/update-content-affinity'
import { applyStrandCUpdate, recenterWeights } from '@/modules/dna/lib/update-strand-c'
import { applyStrandBFromTitle, type TitleNarrativeMetadata } from '@/modules/dna/lib/update-strand-b-from-title'
import type { TitleRow } from '@/modules/dna/lib/load-save'
import type { DNASchema, DNASignal, Reaction } from '@/types/dna'

// 2026-11-06 (Seen split, slice 1): tapping the lit chip again takes the
// rating back. The fingerprint must read as if the title had never been rated:
// these rate a title the way mergeFeedbackSignalsLight does, un-rate it, and
// compare with the state before.

const person = (id: string, name = id) => ({ tmdb_person_id: id, name })

const row = (tmdb_id: string, o: Partial<TitleRow> = {}): TitleRow => ({
  tmdb_id,
  title: `Title ${tmdb_id}`,
  type: 'movie',
  crew: {
    directors: [person('d1')],
    writers: [person('w1')],
    cinematographers: [],
    cast: [{ ...person('a1'), order: 0 }, { ...person('a2'), order: 1 }],
  },
  pacing_tag: 'high_octane',
  tone_tags: ['comedic', 'warm'],
  narrative_metadata: {
    moral_ambiguity: { value: 'medium', confidence: 0.9 },
    originality_weight: { value: 0.8, confidence: 0.9 },
  },
  genres: [{ name: 'Comedy' }, { name: 'Crime' }],
  original_language: 'en',
  ...o,
})

const titles = (...rows: TitleRow[]) => new Map(rows.map((r) => [`${r.type}:${r.tmdb_id}`, r]))

/** What the feedback route + light merge do for one card rating. */
function rate(dna: DNASchema, t: TitleRow, reaction: Reaction) {
  dna.learning_loop.recommendation_history.push({
    session: 1, recommended: `${t.type}:${t.tmdb_id}`, tmdb_id: t.tmdb_id,
    accepted: true, watched: true, rating: reaction, fingerprint_version: 1,
  })
  dna.signals.push({
    title: t.title, tmdb_id: t.tmdb_id, type: t.type, reaction,
    quick_rating: null, regret_signal: null, source: 'recommendation_accepted',
    reason: 'Rated on a recommendation card', dimensions_reinforced: [],
    dimensions_contradicted: [], confidence: 0.75, flag: null,
    watched_at: new Date().toISOString(),
  } as DNASignal)
  applyCrewAffinityUpdate(dna.strand_a_creative_affinity, t.crew, reaction)
  applyStrandCUpdate(dna.strand_c_visceral_specs, t, reaction)
  applyContentAffinityUpdate(dna.strand_c_visceral_specs, t, reaction)
  applyStrandBFromTitle(dna.strand_b_narrative_dimensions, t.narrative_metadata as TitleNarrativeMetadata, reaction)
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))

describe('unrateInDNA', () => {
  it('a first rating, taken back, leaves no trace in people, genres or signals', () => {
    const dna = createBlankDNA('u1')
    const before = clone(dna)
    const t = row('100')
    rate(dna, t, 'loved')

    expect(unrateInDNA(dna, { tmdb_id: '100', media_type: 'movie', saved: false }, titles(t))).toBe(true)

    expect(dna.signals).toEqual([])
    expect(dna.strand_a_creative_affinity).toEqual(before.strand_a_creative_affinity)
    expect(dna.strand_c_visceral_specs.genre_affinity ?? {}).toEqual(before.strand_c_visceral_specs.genre_affinity ?? {})
    expect(dna.strand_c_visceral_specs.language_affinity ?? {}).toEqual(before.strand_c_visceral_specs.language_affinity ?? {})
    expect(dna.strand_c_visceral_specs.format_affinity ?? {}).toEqual(before.strand_c_visceral_specs.format_affinity ?? {})
  })

  it.each<Reaction>(['loved', 'liked', 'disliked'])(
    'with an earlier title in place, %s then un-rate returns people and genres to their earlier scores',
    (reaction) => {
      const dna = createBlankDNA('u1')
      const first = row('100')
      const second = row('200')
      rate(dna, first, 'liked')
      const after1 = clone(dna)
      rate(dna, second, reaction)

      unrateInDNA(dna, { tmdb_id: '200', media_type: 'movie', saved: false }, titles(first, second))

      for (const bucket of ['directors', 'writers', 'actors'] as const) {
        for (const [id, e] of Object.entries(after1.strand_a_creative_affinity[bucket])) {
          const now = dna.strand_a_creative_affinity[bucket][id]
          expect(now.sample_size).toBe(e.sample_size)
          expect(now.score).toBeCloseTo(e.score, 9)
        }
      }
      for (const [g, e] of Object.entries(after1.strand_c_visceral_specs.genre_affinity!)) {
        const now = dna.strand_c_visceral_specs.genre_affinity![g]
        expect(now.sample_size).toBe(e.sample_size)
        expect(now.score).toBeCloseTo(e.score, 9)
      }
      expect(dna.signals.map((s) => s.tmdb_id)).toEqual(['100'])
    },
  )

  it('story traits go back: categorical confidence and the numeric value', () => {
    const dna = createBlankDNA('u1')
    dna.strand_b_narrative_dimensions.moral_ambiguity.confidence = 0.5
    dna.strand_b_narrative_dimensions.originality_weight.value = 0.75
    dna.strand_b_narrative_dimensions.originality_weight.confidence = 0.5
    const before = clone(dna.strand_b_narrative_dimensions)
    const t = row('100')
    rate(dna, t, 'loved')
    expect(dna.strand_b_narrative_dimensions.moral_ambiguity.confidence).not.toBeCloseTo(0.5, 6)

    unrateInDNA(dna, { tmdb_id: '100', media_type: 'movie', saved: false }, titles(t))

    expect(dna.strand_b_narrative_dimensions.moral_ambiguity.confidence).toBeCloseTo(before.moral_ambiguity.confidence, 9)
    expect(dna.strand_b_narrative_dimensions.originality_weight.value as number).toBeCloseTo(before.originality_weight.value as number, 9)
    expect(dna.strand_b_narrative_dimensions.originality_weight.confidence).toBeCloseTo(before.originality_weight.confidence, 9)
  })

  it('mood & pace go back to where they were, once the group is centred', () => {
    const dna = createBlankDNA('u1')
    // Every real user's weights are centred after their first rating (a blank
    // fingerprint's are not, so its first rating also moves the baseline).
    recenterWeights(dna.strand_c_visceral_specs.tone_weights)
    recenterWeights(dna.strand_c_visceral_specs.pacing_weights)
    const before = clone(dna.strand_c_visceral_specs)
    const t = row('100')
    rate(dna, t, 'loved')
    unrateInDNA(dna, { tmdb_id: '100', media_type: 'movie', saved: false }, titles(t))
    for (const k of Object.keys(before.tone_weights) as (keyof typeof before.tone_weights)[]) {
      expect(dna.strand_c_visceral_specs.tone_weights[k]).toBeCloseTo(before.tone_weights[k], 6)
    }
    for (const k of Object.keys(before.pacing_weights) as (keyof typeof before.pacing_weights)[]) {
      expect(dna.strand_c_visceral_specs.pacing_weights[k]).toBeCloseTo(before.pacing_weights[k], 6)
    }
  })

  it('the history entry loses its rating, so the session-end fold has nothing to re-add', () => {
    const dna = createBlankDNA('u1')
    const t = row('100')
    rate(dna, t, 'liked')
    unrateInDNA(dna, { tmdb_id: '100', media_type: 'movie', saved: false }, titles(t))
    const h = dna.learning_loop.recommendation_history.at(-1)!
    expect(h).toMatchObject({ rating: null, accepted: false, watched: false, recommended: 'movie:100' })
  })

  it('on the Watchlist, the history entry goes back to the saved marker', () => {
    const dna = createBlankDNA('u1')
    const t = row('100')
    rate(dna, t, 'loved')
    unrateInDNA(dna, { tmdb_id: '100', media_type: 'movie', saved: true }, titles(t))
    expect(dna.learning_loop.recommendation_history.at(-1)).toMatchObject({ rating: null, accepted: true, watched: false })
  })

  it('a stretch pick is reset and its confidence boost taken back', () => {
    const dna = createBlankDNA('u1')
    dna.strand_b_narrative_dimensions.humor_style.confidence = 0.5
    dna.learning_loop.stretch_pick_history.push({
      title: 'Title 100', tmdb_id: '100', accepted: true, reaction: 'loved', session: 1,
      dimensions_stretched: ['humor_style'],
    })
    dna.strand_b_narrative_dimensions.humor_style.confidence += 0.08 // updateSchemaFromStretch
    unrateInDNA(dna, { tmdb_id: '100', media_type: 'movie', saved: false }, titles())
    expect(dna.learning_loop.stretch_pick_history[0]).toMatchObject({ accepted: false, reaction: null })
    expect(dna.strand_b_narrative_dimensions.humor_style.confidence).toBeCloseTo(0.5, 9)
  })

  it('touches only the matching type: the series with the same id keeps its rating', () => {
    const dna = createBlankDNA('u1')
    const film = row('100')
    const series = row('100', { type: 'tv', crew: { directors: [person('d9')], writers: [], cinematographers: [], cast: [] } })
    rate(dna, film, 'loved')
    rate(dna, series, 'liked')
    unrateInDNA(dna, { tmdb_id: '100', media_type: 'movie', saved: false }, titles(film, series))
    expect(dna.signals.map((s) => `${s.type}:${s.tmdb_id}`)).toEqual(['tv:100'])
    expect(dna.strand_a_creative_affinity.directors.d9).toBeDefined()
  })

  it('nothing rated: reports no change', () => {
    const dna = createBlankDNA('u1')
    expect(unrateInDNA(dna, { tmdb_id: '100', media_type: 'movie', saved: false }, titles())).toBe(false)
  })
})
