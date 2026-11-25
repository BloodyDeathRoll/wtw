import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DNASchema } from '@/types/dna'
import type { ScoredTitleWithPayload } from '@/modules/engine/pipeline/step6-reason-payload'
import type { ReasonPayloadWithTaste } from '@/modules/engine/types'

// v3 F6 follow-up: when your ratings can't be read, the sheet must not say
// "Nobody you've rated is in this one." The payload goes without
// rated_creators, and the sheet falls back to naming its people the old way.

let fail = false
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          in: async () => fail
            ? { data: null, error: { message: 'connection reset' } }
            : { data: [{ tmdb_id: '157336', title: 'Interstellar', crew, tmdb_vote_count: 40233 }], error: null },
        }),
      }),
    }),
  }),
}))

const { loadRatedByPerson, ratedUnavailable } = await import('@/modules/engine/pipeline/step7-card-reason')
const { toResults } = await import('@/modules/engine/pipeline/step7-explanation')
const { clearRatedTitleMemory } = await import('@/modules/engine/pipeline/rated-title-cache')
// Each case reads the database afresh: the per-title cache would answer from memory otherwise (#438).
beforeEach(() => clearRatedTitleMemory())

const crew = {
  directors: [{ tmdb_person_id: '525', name: 'Christopher Nolan' }],
  writers: [], cinematographers: [], cast: [],
}
const dna = { signals: [{ tmdb_id: '157336', type: 'movie', reaction: 'loved' }] } as unknown as DNASchema

const item = {
  title: { tmdb_id: '577922', type: 'movie', title: 'Tenet', crew, synopsis: null },
  composite_score: 0.8,
  is_stretch_pick: false,
  reason_payload: {
    crew_matches: [{ name: 'Christopher Nolan', role: 'director', affinity_score: 0.9 }],
    lineage_connections: [], dimension_matches: [], soft_preferences_applied: [], external_ratings: [],
    is_stretch_pick: false, stretch_rationale: null, groq_rationale: '', negative_signals: [],
  },
} as unknown as ScoredTitleWithPayload

const creatorsOf = (rated?: Parameters<typeof toResults>[1]) =>
  (toResults([item], rated)[0].reason_payload as ReasonPayloadWithTaste).rated_creators

describe('rated_creators when your ratings are unknown', () => {
  it('names the people you rated when the read works', async () => {
    fail = false
    const rated = await loadRatedByPerson(dna)
    expect(ratedUnavailable(rated)).toBe(false)
    expect(creatorsOf(rated)).toEqual([{ name: 'Christopher Nolan', role: 'director', loved: ['Interstellar'], liked: [] }])
  })

  it('leaves rated_creators out when the read fails, not "nobody"', async () => {
    fail = true
    const rated = await loadRatedByPerson(dna)
    expect(ratedUnavailable(rated)).toBe(true)
    expect(creatorsOf(rated)).toBeUndefined()
  })

  it('leaves it out when no ratings are passed at all', () => {
    expect(creatorsOf()).toBeUndefined()
  })

  it('still says nobody when you have rated nothing (a true empty)', async () => {
    // No loved or liked signals returns before any read, so `fail` doesn't matter here.
    const rated = await loadRatedByPerson({ signals: [] } as unknown as DNASchema)
    expect(ratedUnavailable(rated)).toBe(false)
    expect(creatorsOf(rated)).toEqual([])
  })
})
