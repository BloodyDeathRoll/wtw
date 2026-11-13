import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// P1-E6: under FORMULA_V2, step 1's second FRESH pool is the titles the taste
// model scores highest (get_candidate_titles_by_taste, migration 0030), not
// the narrative nearest neighbours. The database and the model are mocked.

const io = vi.hoisted(() => ({
  rpcs: [] as { name: string; args: Record<string, unknown> }[],
  w: [] as number[],
  tasteFails: false,
  trainingFails: false,
  readFails: false,
  trainings: 0,
  embeds: 0,
}))
const row = (id: string, genre = 'Drama') => ({
  tmdb_id: id, type: 'movie', title: id, genres: [{ name: genre }], crew: { directors: [], writers: [], cinematographers: [], cast: [] },
  tone_tags: [], pacing_tag: null, release_year: 2020, tmdb_rating: 7, tmdb_vote_count: 5000, keywords: [], original_language: 'en',
})

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: () => ({ select: () => ({ eq: async () => (io.readFails ? { data: null, error: { message: 'read failed' } } : { data: [], error: null }) }) }),
    rpc: async (name: string, args: Record<string, unknown>) => {
      io.rpcs.push({ name, args })
      if (name === 'get_candidate_titles') return { data: [row('v1'), row('v2')], error: null }
      if (name === 'get_candidate_titles_by_taste') {
        return io.tasteFails ? { data: null, error: { message: 'function does not exist' } } : { data: [row('t1'), row('t2')], error: null }
      }
      return { data: [row('n1')], error: null }
    },
  }),
}))
vi.mock('@/modules/engine/scoring/narrative-match', () => ({
  getUserEmbedding: async () => { io.embeds++; return new Array(1024).fill(0) },
}))
vi.mock('@/modules/dna/load-taste-training', () => ({
  loadTasteTraining: async () => {
    io.trainings++
    if (io.trainingFails) throw new Error('play_events unavailable')
    return { rows: [], pairs: [] }
  },
}))
vi.mock('@/modules/dna/taste-model', async (orig) => ({
  ...(await orig<typeof import('@/modules/dna/taste-model')>()),
  trainTasteModel: () => io.w,
}))

const { getCandidates } = await import('@/modules/engine/pipeline/step1-candidate-gen')
const { createBlankDNA } = await import('@/modules/dna/blank-dna')
const { clearTasteWeights } = await import('@/modules/engine/scoring/taste-weights')

const ids = (xs: { tmdb_id: string }[]) => xs.map(x => x.tmdb_id).sort()
const called = (name: string) => io.rpcs.filter(r => r.name === name)

beforeEach(() => {
  io.rpcs.length = 0
  io.w = [0.5, ...new Array(24).fill(0.1)]
  io.tasteFails = false
  io.trainingFails = false
  io.readFails = false
  io.trainings = 0
  io.embeds = 0
  clearTasteWeights()
})
afterEach(() => { delete process.env.FORMULA_V2 })

describe('step 1 — flag off (today)', () => {
  it('uses the narrative pool and never the taste pool', async () => {
    const out = await getCandidates(createBlankDNA('u1'), undefined, 'movies')
    expect(called('get_candidate_titles_by_narrative')).toHaveLength(1)
    expect(called('get_candidate_titles_by_taste')).toHaveLength(0)
    expect(ids(out)).toEqual(['n1', 'v1', 'v2'])
  })
})

describe('step 1 — FORMULA_V2 on', () => {
  beforeEach(() => { process.env.FORMULA_V2 = 'true' })

  it('replaces the narrative pool with the taste pool, keeping the most-voted one', async () => {
    const out = await getCandidates(createBlankDNA('u1'), undefined, 'movies')
    expect(called('get_candidate_titles_by_narrative')).toHaveLength(0)
    expect(io.embeds).toBe(0) // no fingerprint embedding needed
    expect(ids(out)).toEqual(['t1', 't2', 'v1', 'v2'])
  })

  it('sends the model weights, the vote floors, the over-fetch and the feature version', async () => {
    await getCandidates(createBlankDNA('u1'), undefined, 'series')
    const [{ args }] = called('get_candidate_titles_by_taste')
    expect(args.user_w).toEqual(io.w)
    expect(args.min_votes_movie).toBe(1000)
    expect(args.min_votes_tv).toBe(300)
    expect(args.feature_version).toBe(1)
    expect(args.title_type).toBe('tv')
    expect(args.pool_limit).toBeGreaterThan(150) // over-fetched, then genre-capped to 150
  })

  it('skips the taste pool while the model has learned nothing (w all zeros)', async () => {
    io.w = new Array(25).fill(0)
    const out = await getCandidates(createBlankDNA('u1'), undefined, 'movies')
    expect(called('get_candidate_titles_by_taste')).toHaveLength(0)
    expect(ids(out)).toEqual(['v1', 'v2'])
  })

  it('a failing taste pool costs that pool, not the batch', async () => {
    io.tasteFails = true
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = await getCandidates(createBlankDNA('u1'), undefined, 'movies')
    expect(ids(out)).toEqual(['v1', 'v2'])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[step1] taste pool unavailable'), 'function does not exist')
    warn.mockRestore()
  })

  it('so does a model that cannot be trained', async () => {
    io.trainingFails = true
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = await getCandidates(createBlankDNA('u1'), undefined, 'movies')
    expect(called('get_candidate_titles_by_taste')).toHaveLength(0)
    expect(ids(out)).toEqual(['v1', 'v2'])
    warn.mockRestore()
  })

  it('starts the taste weights before the exclusion reads, and an early throw leaves no unhandled rejection', async () => {
    io.readFails = true
    io.trainingFails = true
    const unhandled: unknown[] = []
    const onUnhandled = (e: unknown) => unhandled.push(e)
    process.on('unhandledRejection', onUnhandled)
    await expect(getCandidates(createBlankDNA('u1'), undefined, 'movies')).rejects.toThrow('removed_titles')
    await new Promise(r => setTimeout(r, 0))
    process.off('unhandledRejection', onUnhandled)
    expect(io.trainings).toBe(1)
    expect(unhandled).toEqual([])
  })
})
