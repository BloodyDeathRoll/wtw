import { describe, it, expect, vi } from 'vitest'

// 2026-11-05: step3b fills the 20% "seen" slice least-served first, so the six
// cards the user was just shown (served once, unrated, still on screen) led
// the next "Find more" batch; the client deduped them and the user got a
// couple of new titles per batch. A title served this sitting is neither
// FRESH nor SEEN until the cooldown passes.

const calls = vi.hoisted(() => ({ rpcs: [] as { name: string; args: Record<string, unknown> }[] }))
const row = (id: string) => ({ tmdb_id: id, type: 'movie', title: id, genres: [], crew: { directors: [], writers: [], cinematographers: [], cast: [] }, tone_tags: [], pacing_tag: null, release_year: 2020, tmdb_rating: 7, tmdb_vote_count: 5000, keywords: [], original_language: 'en' })
const now = Date.now()
const served = [
  { tmdb_id: 'onscreen', media_type: 'movie', times_served: 1, last_served_at: new Date(now - 5 * 60_000).toISOString() },
  { tmdb_id: 'lastweek', media_type: 'movie', times_served: 3, last_served_at: new Date(now - 7 * 24 * 3_600_000).toISOString() },
  { tmdb_id: 'legacy', media_type: 'movie', times_served: 2, last_served_at: null },
]

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => ({
      select: () => ({ eq: async () => ({ data: table === 'served_titles' ? served : [], error: null }) }),
    }),
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.rpcs.push({ name, args })
      if (name === 'get_served_candidates') return { data: [row('lastweek'), row('legacy')], error: null }
      if (name === 'get_candidate_titles') return { data: [row('v1')], error: null }
      return { data: [row('n1')], error: null }
    },
  }),
}))
vi.mock('@/modules/engine/scoring/narrative-match', () => ({
  getUserEmbedding: async () => new Array(1024).fill(0),
}))

const { getCandidates } = await import('@/modules/engine/pipeline/step1-candidate-gen')
const { createBlankDNA } = await import('@/modules/dna/blank-dna')

describe('step 1 — titles served this sitting sit out the next batch', () => {
  it('keeps them out of SEEN but still out of FRESH', async () => {
    calls.rpcs.length = 0
    const candidates = await getCandidates(createBlankDNA('u1'), undefined, 'movies')

    const seen = calls.rpcs.find(r => r.name === 'get_served_candidates')!
    expect(seen.args.served_keys).toEqual(['movie:lastweek', 'movie:legacy'])

    for (const name of ['get_candidate_titles', 'get_candidate_titles_by_narrative']) {
      const fresh = calls.rpcs.find(r => r.name === name)!
      const key = name === 'get_candidate_titles' ? 'watched_keys' : 'exclude_keys'
      expect(fresh.args[key]).toEqual(expect.arrayContaining(['movie:onscreen', 'movie:lastweek', 'movie:legacy']))
    }

    expect(candidates.map(c => c.tmdb_id).sort()).toEqual(['lastweek', 'legacy', 'n1', 'v1'])
    expect(candidates.find(c => c.tmdb_id === 'legacy')?.times_served).toBe(2)
  })
})
