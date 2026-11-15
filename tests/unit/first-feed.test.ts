import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createBlankDNA } from '@/modules/dna/blank-dna'
import type { DNASchema } from '@/types/dna'

// P2-U5: the first feed. kickFirstFeed builds in the background; finishFirstFeed
// waits for a build still running, adopts it if current, else bumps and generates.

const io = vi.hoisted(() => ({
  runningPolls: 0,          // how many polls report a build still running
  promoted: null as number | null,
  bumpOutcome: 'saved' as 'saved' | 'conflict' | 'missing' | 'unchanged',
  generated: [] as { dna: DNASchema; contentType: string }[],
  kicked: [] as string[],
  superseded: [] as string[],
  embedding: undefined as string | undefined,
  version: 7,
  redis: [] as string[],    // first_feed:timings, newest first
  redisDown: false,
}))

vi.mock('@/lib/redis', () => ({
  getRedis: () => {
    if (io.redisDown) throw new Error('Upstash Redis env vars are not set')
    return {
      lpush: async (_k: string, v: string) => { io.redis.unshift(v) },
      ltrim: async (_k: string, a: number, b: number) => { io.redis = io.redis.slice(a, b + 1) },
      lrange: async (_k: string, a: number, b: number) => io.redis.slice(a, b + 1),
    }
  },
}))

vi.mock('@/modules/engine/pipeline/precompute', () => ({
  precomputeNextBatch: async (userId: string, contentType: string, _onParked: unknown, build?: { plotWaitMs?: number }) => {
    io.kicked.push(`${userId}:${contentType}:${build?.plotWaitMs ?? 'default'}`)
  },
  precomputeRunning: async () => io.runningPolls-- > 0,
  holdQuietBuilds: async (userId: string) => { io.superseded.push(userId) },
}))
vi.mock('@/modules/dna/refresh-batch', () => ({ refreshLiveBatch: async (_u: string, _l: string, embedding?: string) => { io.embedding = embedding; return io.promoted } }))
vi.mock('@/modules/dna/lib/load-save', () => ({
  bumpVersion: (dna: DNASchema) => { dna.metadata.taste_version += 1 },
  withDNAUpdate: async (_u: string, mutate: (d: DNASchema) => boolean) => {
    const d = createBlankDNA('u1'); d.metadata.taste_version = io.version
    mutate(d)
    return io.bumpOutcome
  },
}))
vi.mock('@/modules/engine/pipeline/generate', () => ({
  INLINE_PLOT_WAIT_MS: 400,
  generateRecommendations: async (_u: string, _s: unknown, opts: { dna: DNASchema; contentType: string }) => {
    io.generated.push({ dna: opts.dna, contentType: opts.contentType })
    return []
  },
}))

const { kickFirstFeed, finishFirstFeed, firstFeedTimings } = await import('@/modules/engine/first-feed')

beforeEach(() => {
  io.runningPolls = 0
  io.promoted = null
  io.bumpOutcome = 'saved'
  io.generated = []
  io.kicked = []
  io.superseded = []
  io.redis = []
  io.redisDown = false
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

describe('kickFirstFeed', () => {
  // Eran's first run (#246, 2026-11-13): the batch was built for 'all' while the
  // feed opens on "movies", and each build waited 2.5 s for new plot summaries.
  it('builds the list the feed opens on (FEED_START_TYPE, "all"), without waiting for new plot summaries (#246: 0, cached ones only)', async () => {
    await kickFirstFeed('u1')
    expect(io.kicked).toEqual(['u1:all:0'])
  })
  it('a caller can ask for another list', async () => {
    await kickFirstFeed('u1', 'series')
    expect(io.kicked).toEqual(['u1:series:0'])
  })
})

describe('finishFirstFeed', () => {
  it('adopts the batch built during onboarding when it is current', async () => {
    io.promoted = 8
    const r = await finishFirstFeed('u1')
    expect(r).toMatchObject({ taste_version: 8, adopted: true })
    expect(io.generated).toHaveLength(0)
  })

  it('waits for a build the last answer started, then adopts it', async () => {
    io.runningPolls = 3
    io.promoted = 8
    const r = await finishFirstFeed('u1')
    expect(io.runningPolls).toBeLessThan(0) // polled until it reported done
    expect(r.adopted).toBe(true)
    expect(r.ms).toBeGreaterThanOrEqual(3 * 150 - 20)
  })

  it('with nothing current parked: bumps the version and generates the starting list at it', async () => {
    const r = await finishFirstFeed('u1')
    expect(r).toMatchObject({ taste_version: 8, adopted: false })
    expect(io.generated).toHaveLength(1)
    expect(io.generated[0].dna.metadata.taste_version).toBe(8)
    expect(io.generated[0].contentType).toBe('all')
  })

  // #246, Eran's run 2026-11-15: a card answer flushed just before the finish
  // started a quiet build that could re-promote the feed while it loaded.
  it('asks the adoption to move the stored embedding after the response (#246, agreed by Eran as A3)', async () => {
    io.promoted = 8
    await finishFirstFeed('u1')
    expect(io.embedding).toBe('after-response')
  })

  it('holds the quiet build the last card answer queued, so it can\'t rebuild or re-promote while the feed loads', async () => {
    io.promoted = 8
    await finishFirstFeed('u1')
    expect(io.superseded).toEqual(['u1'])
  })

  it('throws when the fingerprint can\'t be bumped, so the screen shows "Try again"', async () => {
    io.bumpOutcome = 'conflict'
    await expect(finishFirstFeed('u1')).rejects.toThrow(/could not bump/)
    expect(io.generated).toHaveLength(0)
  })
})

// #246: Vercel keeps runtime logs an hour, so the timing is also kept in Redis.
describe('first-feed timings', () => {
  const settle = () => new Promise(r => setTimeout(r, 0))

  it('records each finish: total, the wait for a running build, adopted; no user id', async () => {
    io.runningPolls = 2
    io.promoted = 8
    const r = await finishFirstFeed('u1')
    await settle()
    const [t] = await firstFeedTimings()
    expect(t).toMatchObject({ ms: r.ms, adopted: true })
    expect(t.waited_ms).toBeGreaterThanOrEqual(2 * 150 - 20)
    expect(t.waited_ms).toBeLessThanOrEqual(t.ms)
    expect(io.redis[0]).not.toContain('u1')
  })

  it('records a failed finish too, with its error, and still throws', async () => {
    io.bumpOutcome = 'conflict'
    await expect(finishFirstFeed('u1')).rejects.toThrow(/could not bump/)
    await settle()
    const [t] = await firstFeedTimings()
    expect(t).toMatchObject({ adopted: false, error: expect.stringMatching(/could not bump/) })
  })

  it('keeps the last 50, newest first, and skips a corrupt row', async () => {
    io.promoted = 8
    for (let i = 0; i < 52; i++) await finishFirstFeed('u1')
    await settle()
    expect(io.redis).toHaveLength(50)
    io.redis.splice(1, 0, '{not json')
    const ts = await firstFeedTimings()
    expect(ts).toHaveLength(49)            // 50 read, the corrupt one skipped
    expect(ts.every(t => t.adopted)).toBe(true)
  })

  it('Redis down: the first feed still works', async () => {
    io.redisDown = true
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    io.promoted = 8
    await expect(finishFirstFeed('u1')).resolves.toMatchObject({ adopted: true })
    await settle()
  })
})
