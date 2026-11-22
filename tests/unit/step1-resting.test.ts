import { describe, it, expect, vi, afterEach } from 'vitest'

// v3 F4 (FOR-YOU.md DEC-6, #351): with FOR_YOU_V3 on, resting replaces step 1's 20% "seen" share. A resting or
// retired title is left out of the served pool; the rest compete on score as if never shown. Flag off: unchanged
// (step1-seen-cooldown.test.ts, step1-served-pool.test.ts).

const calls = vi.hoisted(() => ({ rpcs: [] as { name: string; args: Record<string, unknown> }[], selects: [] as string[] }))
const row = (id: string) => ({ tmdb_id: id, type: 'movie', title: id, genres: [], crew: { directors: [], writers: [], cinematographers: [], cast: [] }, tone_tags: [], pacing_tag: null, release_year: 2020, tmdb_rating: 7, tmdb_vote_count: 5000, keywords: [], original_language: 'en' })
const now = Date.now()
const weekAgo = new Date(now - 8 * 24 * 3_600_000).toISOString()
const served = [
  { tmdb_id: 'flicked', media_type: 'movie', times_served: 1, last_served_at: weekAgo, skips: 0, rest_until: null },
  { tmdb_id: 'resting', media_type: 'movie', times_served: 1, last_served_at: weekAgo, skips: 1, rest_until: new Date(now + 3 * 24 * 3_600_000).toISOString() },
  { tmdb_id: 'back', media_type: 'movie', times_served: 1, last_served_at: weekAgo, skips: 1, rest_until: new Date(now - 3_600_000).toISOString() },
  { tmdb_id: 'retired', media_type: 'movie', times_served: 3, last_served_at: weekAgo, skips: 3, rest_until: null },
]

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => ({
      select: (cols: string) => {
        if (table === 'served_titles') calls.selects.push(cols)
        return { eq: async () => ({ data: table === 'served_titles' ? served : [], error: null }) }
      },
    }),
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.rpcs.push({ name, args })
      if (name === 'get_served_candidates') return { data: (args.served_keys as string[]).map(k => row(k.split(':')[1])), error: null }
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

afterEach(() => { vi.unstubAllEnvs(); calls.rpcs.length = 0; calls.selects.length = 0 })

describe('step 1 with FOR_YOU_V3 on — resting replaces the seen 20%', () => {
  it('leaves resting and retired titles out; flicked and returning ones compete as if never shown', async () => {
    vi.stubEnv('FOR_YOU_V3', 'true')
    const candidates = await getCandidates(createBlankDNA('u1'), undefined, 'movies')

    const seen = calls.rpcs.find(r => r.name === 'get_served_candidates')!
    expect(seen.args.served_keys).toEqual(['movie:flicked', 'movie:back'])
    expect(candidates.map(c => c.tmdb_id).sort()).toEqual(['back', 'flicked', 'n1', 'v1'])
    expect(candidates.every(c => c.previously_served === false)).toBe(true)
    // A database without migration 0035 still reads: '*' brings back whatever columns there are.
    expect(calls.selects).toEqual(['*'])
  })

  it('flag off: today\'s served pool and its 20% share, untouched', async () => {
    const candidates = await getCandidates(createBlankDNA('u1'), undefined, 'movies')
    const seen = calls.rpcs.find(r => r.name === 'get_served_candidates')!
    expect(seen.args.served_keys).toEqual(['movie:flicked', 'movie:resting', 'movie:back', 'movie:retired'])
    expect(candidates.filter(c => c.previously_served).map(c => c.tmdb_id).sort()).toEqual(['back', 'flicked', 'resting', 'retired'])
    expect(calls.selects).toEqual(['tmdb_id, media_type, times_served, last_served_at'])
  })
})
