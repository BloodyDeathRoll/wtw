import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createFakeRedis, type FakeRedis } from '../mocks'
import { createBlankDNA } from '@/modules/dna/blank-dna'
import type { RecommendationResult } from '@/types/dna'

// 2026-11-13 (#240): building on every rating ran 27 full pipelines in 12
// minutes of one person rating and stalled the DB. A burst now costs one
// build, after the last rating.

let redis: FakeRedis
vi.mock('@/lib/redis', () => ({ getRedis: () => redis }))
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { dna: createBlankDNA('u1') }, error: null }) }) }) }),
  }),
}))
const generateRecommendations = vi.fn(async () => [{ tmdb_id: '900', type: 'movie' } as unknown as RecommendationResult])
vi.mock('@/modules/engine/pipeline/generate', () => ({
  generateRecommendations: () => generateRecommendations(),
  scheduleExplanationPatch: () => {},
}))

const { precomputeWhenQuiet, QUIET_MS } = await import('@/modules/engine/pipeline/precompute')

beforeEach(() => {
  redis = createFakeRedis()
  const plainSet = redis.set.getMockImplementation()!
  redis.set.mockImplementation((async (key: string, value: unknown, opts?: { ex?: number; nx?: boolean }) =>
    opts?.nx && redis.store.has(key) ? null : plainSet(key, value, opts)) as unknown as typeof plainSet)
  generateRecommendations.mockClear()
})

describe('precomputeWhenQuiet', () => {
  it('builds once the user pauses', async () => {
    const waited: number[] = []
    await precomputeWhenQuiet('u1', 'movies', undefined, async ms => { waited.push(ms) })
    expect(waited).toEqual([QUIET_MS])
    expect(generateRecommendations).toHaveBeenCalledTimes(1)
  })

  it('a burst of ratings costs one build, from the last one', async () => {
    const hooks = [vi.fn(async () => {}), vi.fn(async () => {}), vi.fn(async () => {})]
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    // Every call waits on the same gate, so all three stamp before any wakes.
    const calls = hooks.map(h => precomputeWhenQuiet('u1', 'movies', h, () => gate))
    // Wake them only once all three have stamped.
    await vi.waitFor(() => expect(redis.set.mock.calls.filter(c => String(c[0]).startsWith('rec_precompute_quiet:')).length).toBe(3))
    release()
    await Promise.all(calls)
    expect(generateRecommendations).toHaveBeenCalledTimes(1)
    expect(hooks.map(h => h.mock.calls.length)).toEqual([0, 0, 1])
    expect(log).toHaveBeenCalledTimes(2)
    log.mockRestore()
  })

  it('a series rating during the movie wait does not cancel the movie build', async () => {
    let releaseMovies!: () => void, releaseSeries!: () => void
    const movieGate = new Promise<void>(r => { releaseMovies = r })
    const seriesGate = new Promise<void>(r => { releaseSeries = r })
    const movies = precomputeWhenQuiet('u1', 'movies', undefined, () => movieGate)
    const series = precomputeWhenQuiet('u1', 'series', undefined, () => seriesGate)
    await vi.waitFor(() => expect(redis.set.mock.calls.filter(c => String(c[0]).startsWith('rec_precompute_quiet:')).length).toBe(2))
    releaseMovies(); await movies
    releaseSeries(); await series
    expect(redis.store.has('rec_pending3:u1:movies')).toBe(true)
    expect(redis.store.has('rec_pending3:u1:series')).toBe(true)
  })

  it('builds anyway when Redis fails', async () => {
    redis.set.mockRejectedValueOnce(new Error('redis down'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await precomputeWhenQuiet('u1', 'movies', undefined, async () => {})
    expect(generateRecommendations).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})
