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
  version: 7,
}))

vi.mock('@/modules/engine/pipeline/precompute', () => ({
  precomputeNextBatch: async (userId: string, contentType: string, _onParked: unknown, build?: { plotWaitMs?: number }) => {
    io.kicked.push(`${userId}:${contentType}:${build?.plotWaitMs ?? 'default'}`)
  },
  precomputeRunning: async () => io.runningPolls-- > 0,
}))
vi.mock('@/modules/dna/refresh-batch', () => ({ refreshLiveBatch: async () => io.promoted }))
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

const { kickFirstFeed, finishFirstFeed } = await import('@/modules/engine/first-feed')

beforeEach(() => {
  io.runningPolls = 0
  io.promoted = null
  io.bumpOutcome = 'saved'
  io.generated = []
  io.kicked = []
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

describe('kickFirstFeed', () => {
  // Eran's first run (#246, 2026-11-13): the batch was built for 'all' while the
  // feed opens on "movies", and each build waited 2.5 s for new plot summaries.
  it('builds the list the feed opens on ("movies"), without waiting for new plot summaries', async () => {
    await kickFirstFeed('u1')
    expect(io.kicked).toEqual(['u1:movies:400'])
  })
  it('a caller can ask for another list', async () => {
    await kickFirstFeed('u1', 'series')
    expect(io.kicked).toEqual(['u1:series:400'])
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

  it('with nothing current parked: bumps the version and generates the "movies" feed at it', async () => {
    const r = await finishFirstFeed('u1')
    expect(r).toMatchObject({ taste_version: 8, adopted: false })
    expect(io.generated).toHaveLength(1)
    expect(io.generated[0].dna.metadata.taste_version).toBe(8)
    expect(io.generated[0].contentType).toBe('movies')
  })

  it('throws when the fingerprint can\'t be bumped, so the screen shows "Try again"', async () => {
    io.bumpOutcome = 'conflict'
    await expect(finishFirstFeed('u1')).rejects.toThrow(/could not bump/)
    expect(io.generated).toHaveLength(0)
  })
})
