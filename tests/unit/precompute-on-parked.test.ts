import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createFakeRedis, type FakeRedis } from '../mocks'
import { createBlankDNA } from '@/modules/dna/blank-dna'
import type { RecommendationResult } from '@/types/dna'

// 2026-10-07 (Dream 2026-10-07): the every-5th-rating refresh is promoted by
// the precompute that holds the lock, right after it parks — never by the
// caller that found the lock taken. These pin where the hook runs: after the
// park, inside the lock, once per park including the extra dirty-forced run.

let redis: FakeRedis
vi.mock('@/lib/redis', () => ({ getRedis: () => redis }))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ single: async () => ({ data: { dna: createBlankDNA('u1') }, error: null }) }),
      }),
    }),
  }),
}))

const generateRecommendations = vi.fn(async () => [{ tmdb_id: '900', type: 'movie' } as unknown as RecommendationResult])
vi.mock('@/modules/engine/pipeline/generate', () => ({
  generateRecommendations: () => generateRecommendations(),
  scheduleExplanationPatch: () => {},
}))

const { precomputeNextBatch } = await import('@/modules/engine/pipeline/precompute')

const LOCK = 'rec_precompute_lock:u1'
const DIRTY = 'rec_precompute_dirty:u1'
const PENDING = 'rec_pending:u1:movies'

beforeEach(() => {
  redis = createFakeRedis()
  // The fake ignores NX; the lock depends on it.
  const plainSet = redis.set.getMockImplementation()!
  const nxSet = async (key: string, value: unknown, opts?: { ex?: number; nx?: boolean }) =>
    opts?.nx && redis.store.has(key) ? null : plainSet(key, value, opts)
  redis.set.mockImplementation(nxSet as unknown as typeof plainSet)
  generateRecommendations.mockClear()
})

describe('precomputeNextBatch onParked', () => {
  it('runs after the park, while the lock is still held', async () => {
    const seen: { parked: boolean; locked: boolean }[] = []
    await precomputeNextBatch('u1', 'movies', async () => {
      seen.push({ parked: redis.store.has(PENDING), locked: redis.store.has(LOCK) })
    })

    expect(seen).toEqual([{ parked: true, locked: true }])
    expect(redis.store.has(LOCK)).toBe(false)
  })

  it('never runs for a caller that found the lock taken — that call only flags the build dirty', async () => {
    redis.store.set(LOCK, '1')
    const hook = vi.fn(async () => {})
    await precomputeNextBatch('u1', 'movies', hook)

    expect(hook).not.toHaveBeenCalled()
    expect(generateRecommendations).not.toHaveBeenCalled()
    expect(redis.store.get(DIRTY)).toBe('1')
  })

  it('runs once per park, including the extra run a dirty flag forces', async () => {
    let calls = 0
    await precomputeNextBatch('u1', 'movies', async () => {
      calls++
      // A rating landed mid-build: the holder must go once more, and promote again.
      if (calls === 1) redis.store.set(DIRTY, '1')
    })

    expect(generateRecommendations).toHaveBeenCalledTimes(2)
    expect(calls).toBe(2)
  })

  it('a failing hook does not stop the park or release the lock early', async () => {
    await precomputeNextBatch('u1', 'movies', async () => { throw new Error('promotion failed') })
    expect(redis.store.has(PENDING)).toBe(true)
    expect(redis.store.has(LOCK)).toBe(false)
  })
})
