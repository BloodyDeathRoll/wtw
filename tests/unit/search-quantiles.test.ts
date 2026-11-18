import { describe, it, expect, vi, beforeEach } from 'vitest'

// v3 Q4: a search never waits ~1.5 s for the vote quantiles. On a miss it
// ranks without them and they're filled in the background, once.

const io = vi.hoisted(() => ({ redis: new Map<string, unknown>(), rpcCalls: 0 }))
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: () => { throw new Error('outside a request') } }))
vi.mock('@/lib/redis', () => ({ getRedis: () => ({
  get: async (k: string) => io.redis.get(k) ?? null,
  set: async (k: string, v: unknown) => { io.redis.set(k, v) },
}) }))
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({
  rpc: async () => { io.rpcCalls++; return { data: [{ type: 'movie', cuts: [0, 10, 100] }, { type: 'tv', cuts: [0, 5, 50] }], error: null } },
}) }))

const { voteQuantiles, clearVoteQuantiles } = await import('@/lib/search-catalogue')
beforeEach(() => { io.redis.clear(); io.rpcCalls = 0; clearVoteQuantiles() })

describe('voteQuantiles', () => {
  it('a miss: answers {} at once and fills them in the background, once', async () => {
    const [a, b] = await Promise.all([voteQuantiles(), voteQuantiles()])
    expect(a).toEqual({}); expect(b).toEqual({})
    await new Promise(r => setTimeout(r, 0))
    expect(io.rpcCalls).toBe(1)
    expect(await voteQuantiles()).toEqual({ movie: [0, 10, 100], tv: [0, 5, 50] })
  })
  it('from Redis when another instance filled them', async () => {
    io.redis.set('search:vote_quantiles', { movie: [1, 2] })
    expect(await voteQuantiles()).toEqual({ movie: [1, 2] })
    expect(io.rpcCalls).toBe(0)
  })
})
