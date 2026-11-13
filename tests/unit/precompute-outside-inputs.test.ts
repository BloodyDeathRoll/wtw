import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createFakeRedis, type FakeRedis } from '../mocks'
import { createBlankDNA } from '@/modules/dna/blank-dna'
import type { RecommendationResult } from '@/types/dna'

// P2-U5: under formula v2 a parked batch is adopted only if the picks and the
// genre answers it was built from are still the same — a new user's last picks
// land after their first batch was precomputed. Under v1 the hash is as before.

let redis: FakeRedis
vi.mock('@/lib/redis', () => ({ getRedis: () => redis }))

const db = vi.hoisted(() => ({
  picks: { count: 3, lastId: 30 },
  gen: { comedy: 2 } as Record<string, number>,
  picksFail: false,
}))
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      const q: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'not', 'order']) q[m] = () => q
      q.single = async () => ({ data: { dna: createBlankDNA('u1') }, error: null })
      q.limit = async () => db.picksFail
        ? { data: null, count: null, error: { message: 'timeout' } }
        : { data: db.picks.count ? [{ id: db.picks.lastId }] : [], count: db.picks.count, error: null }
      q.maybeSingle = async () => ({ data: table === 'play_state' ? { state: { gen: db.gen } } : null, error: null })
      return q
    },
  }),
}))

vi.mock('@/modules/engine/pipeline/generate', () => ({
  generateRecommendations: async () => [{ tmdb_id: '900', type: 'movie', composite_score: 0.9 } as unknown as RecommendationResult],
  scheduleExplanationPatch: () => {},
}))

const { precomputeNextBatch, adoptPendingBatch, generationInputsHash, outsideInputsMark } = await import('@/modules/engine/pipeline/precompute')

beforeEach(() => {
  redis = createFakeRedis()
  // adoptPendingBatch takes the parked batch atomically; the shared fake has no getdel.
  Object.assign(redis, {
    getdel: vi.fn(async (key: string) => { const v = redis.store.get(key) ?? null; redis.store.delete(key); return v }),
  })
  db.picks = { count: 3, lastId: 30 }
  db.gen = { comedy: 2 }
  db.picksFail = false
})
afterEach(() => { delete process.env.FORMULA_V2 })

describe('outsideInputsMark', () => {
  it('is empty under v1, so the hash is exactly what it was', async () => {
    const dna = createBlankDNA('u1')
    expect(await outsideInputsMark('u1')).toBe('')
    expect(generationInputsHash(dna, '')).toBe(generationInputsHash(dna))
  })

  it('under v2, moves with a new pick and with a changed genre answer', async () => {
    process.env.FORMULA_V2 = 'true'
    const a = await outsideInputsMark('u1')
    db.picks = { count: 4, lastId: 31 }
    const b = await outsideInputsMark('u1')
    db.gen = { comedy: 1 }
    const c = await outsideInputsMark('u1')
    expect(new Set([a, b, c]).size).toBe(3)
  })

  it('a failed read matches nothing, so nothing stale is adopted', async () => {
    process.env.FORMULA_V2 = 'true'
    db.picksFail = true
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await outsideInputsMark('u1')).not.toBe(await outsideInputsMark('u1'))
    warn.mockRestore()
  })
})

describe('adopting a parked batch under v2', () => {
  beforeEach(() => { process.env.FORMULA_V2 = 'true' })

  it('adopts it when no pick or answer has landed since', async () => {
    await precomputeNextBatch('u1', 'all')
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(await adoptPendingBatch('u1', createBlankDNA('u1'), 'all')).toHaveLength(1)
    log.mockRestore()
  })

  it('refuses it after another pick, even though the DNA is the same', async () => {
    await precomputeNextBatch('u1', 'all')
    db.picks = { count: 4, lastId: 31 }
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(await adoptPendingBatch('u1', createBlankDNA('u1'), 'all')).toBeNull()
    expect(log).toHaveBeenCalledWith(expect.stringContaining('stale'))
    log.mockRestore()
  })

  it('refuses it after a changed genre answer (DEC-13)', async () => {
    await precomputeNextBatch('u1', 'all')
    db.gen = { comedy: 2, horror: -5 }
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(await adoptPendingBatch('u1', createBlankDNA('u1'), 'all')).toBeNull()
    log.mockRestore()
  })
})

describe('under v1 picks don\'t matter', () => {
  it('adopts after another pick, as today', async () => {
    await precomputeNextBatch('u1', 'all')
    db.picks = { count: 4, lastId: 31 }
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(await adoptPendingBatch('u1', createBlankDNA('u1'), 'all')).toHaveLength(1)
    log.mockRestore()
  })
})
