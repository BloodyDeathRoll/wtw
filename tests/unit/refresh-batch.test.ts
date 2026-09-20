import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createFakeRedis, type FakeRedis } from '../mocks'
import { createBlankDNA } from '@/modules/dna/blank-dna'
import type { DNASchema, RecommendationResult } from '@/types/dna'

// 2026-09-06: a card rating deliberately doesn't bump taste_version, so a user
// could rate ten anime down and keep being served anime until they clicked
// "Find more". These pin the mid-session refresh — and, above all, that the
// version is never bumped without a batch cached under it, which would drop
// the feed to a cold regeneration or to mocks.

let redis: FakeRedis
vi.mock('@/lib/redis', () => ({ getRedis: () => redis }))

// A users row that answers a select and records the conditional update.
let dbState: {
  dna: DNASchema | null
  updated_at: string
  /** What the update's `.eq('updated_at', …)` must match to affect a row. */
  casValue: string
  updates: unknown[]
}

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: () => {
      let op: 'select' | 'update' = 'select'
      let payload: unknown = null
      let casSeen: string | null = null
      const builder = {
        select: () => builder,
        update: (p: unknown) => { op = 'update'; payload = p; return builder },
        eq: (col: string, val: string) => { if (col === 'updated_at') casSeen = val; return builder },
        single: async () => ({
          data: dbState.dna ? { dna: dbState.dna, updated_at: dbState.updated_at } : null,
          error: null,
        }),
        then: (resolve: (v: unknown) => unknown) => {
          if (op === 'update') {
            const matched = casSeen === dbState.casValue
            if (matched) dbState.updates.push(payload)
            return resolve({ data: matched ? [{ id: 'u1' }] : [], error: null })
          }
          return resolve({ data: null, error: null })
        },
      }
      return builder
    },
  }),
}))

const adoptPendingBatch = vi.fn<
  (userId: string, dna: DNASchema, contentType: string) => Promise<RecommendationResult[] | null>
>()
vi.mock('@/modules/engine/pipeline/precompute', () => ({
  adoptPendingBatch: (...args: unknown[]) =>
    adoptPendingBatch(...(args as Parameters<typeof adoptPendingBatch>)),
}))

const regenerateEmbedding = vi.fn(async () => {})
vi.mock('@/modules/dna/lib/regenerate-embedding', () => ({
  regenerateEmbedding: () => regenerateEmbedding(),
}))

const { countRatingTowardRefresh, refreshLiveBatch, RATINGS_PER_REFRESH } =
  await import('@/modules/dna/refresh-batch')

const savedDna = () => dbState.updates.at(-1) as { dna: DNASchema } | undefined

beforeEach(() => {
  redis = createFakeRedis()
  const dna = createBlankDNA('u1')
  dna.metadata.taste_version = 7
  dbState = { dna, updated_at: 't0', casValue: 't0', updates: [] }
  adoptPendingBatch.mockReset()
  adoptPendingBatch.mockResolvedValue([{ tmdb_id: '1' } as unknown as RecommendationResult])
  regenerateEmbedding.mockClear()
})

describe('rating counter', () => {
  it('fires once every N ratings, not before', async () => {
    const fired: boolean[] = []
    for (let i = 0; i < RATINGS_PER_REFRESH; i++) fired.push(await countRatingTowardRefresh('u1'))

    expect(fired.slice(0, -1).every(f => f === false)).toBe(true)
    expect(fired.at(-1)).toBe(true)
  })

  it('starts counting again after it fires', async () => {
    for (let i = 0; i < RATINGS_PER_REFRESH; i++) await countRatingTowardRefresh('u1')
    expect(await countRatingTowardRefresh('u1')).toBe(false)
  })

  it('counts each user separately', async () => {
    for (let i = 0; i < RATINGS_PER_REFRESH - 1; i++) await countRatingTowardRefresh('u1')
    expect(await countRatingTowardRefresh('u2')).toBe(false)
  })

  it('says no rather than throwing when Redis is unreachable', async () => {
    redis.incr.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    expect(await countRatingTowardRefresh('u1')).toBe(false)
  })
})

describe('refreshLiveBatch', () => {
  it('bumps the version and saves once the batch is cached under it', async () => {
    const version = await refreshLiveBatch('u1', 'all')

    expect(version).toBe(8)
    expect(adoptPendingBatch).toHaveBeenCalledWith('u1', expect.objectContaining({
      metadata: expect.objectContaining({ taste_version: 8 }),
    }), 'all')
    expect(savedDna()?.dna.metadata.taste_version).toBe(8)
  })

  it('does NOT save a bumped version when there is nothing to promote', async () => {
    // A version with no cache behind it is worse than a stale batch: the feed
    // falls through to a cold regeneration, or to mocks.
    adoptPendingBatch.mockResolvedValue(null)

    expect(await refreshLiveBatch('u1', 'all')).toBeNull()
    expect(dbState.updates).toHaveLength(0)
    expect(regenerateEmbedding).not.toHaveBeenCalled()
  })

  it('leaves the fingerprint alone when a rating landed underneath it', async () => {
    dbState.casValue = 't1' // the row moved on after we read it

    expect(await refreshLiveBatch('u1', 'all')).toBeNull()
    expect(dbState.updates).toHaveLength(0)
  })

  it('moves the stored embedding onto the new version', async () => {
    // Otherwise the next generation re-embeds from scratch — the one real
    // cost this path exists to avoid.
    await refreshLiveBatch('u1', 'all')
    expect(regenerateEmbedding).toHaveBeenCalledOnce()
  })

  it('still refreshes when the embedding update fails', async () => {
    regenerateEmbedding.mockRejectedValueOnce(new Error('mistral down'))
    expect(await refreshLiveBatch('u1', 'all')).toBe(8)
  })

  it('does nothing for a user with no fingerprint', async () => {
    dbState.dna = null
    expect(await refreshLiveBatch('u1', 'all')).toBeNull()
    expect(adoptPendingBatch).not.toHaveBeenCalled()
  })
})
