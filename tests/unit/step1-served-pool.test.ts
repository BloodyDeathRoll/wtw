import { describe, it, expect, vi } from 'vitest'

// 2026-10-21: on a user's 15th rating get_served_candidates hit the statement
// timeout and the whole generation failed with it — nothing parked, the
// refresh stayed armed, the user kept the cold batch. The seen slice is at
// most 20% of a batch; losing it must cost that slice, not the batch.

const calls = vi.hoisted(() => ({ rpcs: [] as string[] }))
const row = (id: string) => ({ tmdb_id: id, type: 'movie', title: id, genres: [], crew: { directors: [], writers: [], cinematographers: [], cast: [] }, tone_tags: [], pacing_tag: null, release_year: 2020, tmdb_rating: 7, tmdb_vote_count: 5000, keywords: [], original_language: 'en' })

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: async () => ({
          data: table === 'served_titles' ? [{ tmdb_id: 's1', media_type: 'movie', times_served: 1 }] : [],
          error: null,
        }),
      }),
    }),
    rpc: async (name: string) => {
      calls.rpcs.push(name)
      if (name === 'get_served_candidates') return { data: null, error: { message: 'canceling statement due to statement timeout' } }
      if (name === 'get_candidate_titles') return { data: [row('v1'), row('v2')], error: null }
      return { data: [row('n1')], error: null }
    },
  }),
}))
vi.mock('@/modules/engine/scoring/narrative-match', () => ({
  getUserEmbedding: async () => new Array(1024).fill(0),
}))

const { getCandidates } = await import('@/modules/engine/pipeline/step1-candidate-gen')
const { createBlankDNA } = await import('@/modules/dna/blank-dna')

describe('step 1 — served pool is best-effort', () => {
  it('a served-pool failure costs the seen slice, not the batch', async () => {
    calls.rpcs.length = 0
    const dna = createBlankDNA('u1')
    const candidates = await getCandidates(dna, undefined, 'movies')
    expect(calls.rpcs).toContain('get_served_candidates')
    expect(candidates.map(c => c.tmdb_id).sort()).toEqual(['n1', 'v1', 'v2'])
    expect(candidates.every(c => c.previously_served === false)).toBe(true)
  })
})
