import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createBlankDNA } from '@/modules/dna/blank-dna'
import { applyTemporalDecay, decayCutoff } from '@/modules/dna/lib/apply-temporal-decay'
import type { DNASchema, DNASignal } from '@/types/dna'

// #457 (Eran's OK, 2026-11-26): decay per signal. Each signal past 18 months is halved once and marked
// (`decayed_at`); one that passes 18 months later is halved then. The cron reads only the DNAs with one due.

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-11-26T04:00:00Z')
const daysAgo = (d: number) => new Date(NOW - d * DAY).toISOString()
const OLD = 600      // > 18 × 30 days
const RECENT = 30

const sig = (id: string, watchedDaysAgo: number | null, extra: Partial<DNASignal> = {}): DNASignal => ({
  title: id, tmdb_id: id, type: 'movie', reaction: 'loved', quick_rating: null, regret_signal: null, source: 'manual',
  reason: '', dimensions_reinforced: [], dimensions_contradicted: [], confidence: 0.8, flag: null,
  watched_at: watchedDaysAgo == null ? null : daysAgo(watchedDaysAgo), ...extra,
})
function dnaWith(signals: DNASignal[]): DNASchema {
  const d = createBlankDNA('u1')
  d.signals = signals
  d.strand_a_creative_affinity.directors = { p1: { name: 'A', score: 0.9, confidence: 0.8 } } as never
  return d
}
const conf = (d: DNASchema, id: string) => d.signals.find(s => s.tmdb_id === id)!.confidence
const crew = (d: DNASchema) => (d.strand_a_creative_affinity.directors as unknown as Record<string, { confidence: number }>).p1.confidence

describe('applyTemporalDecay, per signal (#457)', () => {
  it('halves a signal past 18 months once, marks it, and leaves recent and undated ones alone', () => {
    const d = dnaWith([sig('old', OLD), sig('new', RECENT), sig('undated', null)])
    expect(applyTemporalDecay(d, NOW)).toBe(1)
    expect(conf(d, 'old')).toBeCloseTo(0.4)
    expect(d.signals[0].decayed_at).toBe(new Date(NOW).toISOString())
    expect(conf(d, 'new')).toBe(0.8)
    expect(conf(d, 'undated')).toBe(0.8)
    expect(d.learning_loop.temporal_decay_applied).toBe(true)
  })

  it('never halves the same signal twice: the next night is a no-op', () => {
    const d = dnaWith([sig('old', OLD)])
    applyTemporalDecay(d, NOW)
    expect(applyTemporalDecay(d, NOW + DAY)).toBe(0)
    expect(conf(d, 'old')).toBeCloseTo(0.4)
  })

  it("Eran's case: a DNA that decayed before, with a newer signal now past 18 months, gets that one halved", () => {
    const earlier = new Date(NOW - 200 * DAY).toISOString()
    const d = dnaWith([
      sig('decayed-before', OLD + 200, { confidence: 0.4, decayed_at: earlier }),
      sig('now-old', OLD),
      sig('recent', RECENT),
    ])
    d.learning_loop.temporal_decay_applied = true   // the old per-DNA flag would have skipped this DNA forever
    expect(applyTemporalDecay(d, NOW)).toBe(1)
    expect(conf(d, 'now-old')).toBeCloseTo(0.4)
    expect(conf(d, 'decayed-before')).toBe(0.4)                  // not halved again
    expect(d.signals[0].decayed_at).toBe(earlier)
    expect(conf(d, 'recent')).toBe(0.8)
  })

  it('crew: halved on the first decay when nothing recent exists, and only that once', () => {
    const d = dnaWith([sig('a', OLD + 10)])
    applyTemporalDecay(d, NOW)
    expect(crew(d)).toBeCloseTo(0.4)
    d.signals.push(sig('b', OLD))                                 // another one passes 18 months later
    expect(applyTemporalDecay(d, NOW)).toBe(1)
    expect(crew(d)).toBeCloseTo(0.4)                              // the crew isn't halved again
  })

  it('crew: kept when any recent signal exists', () => {
    const d = dnaWith([sig('old', OLD), sig('new', RECENT)])
    applyTemporalDecay(d, NOW)
    expect(crew(d)).toBe(0.8)
  })

  it("nothing due: returns 0 and doesn't touch the flag", () => {
    const d = dnaWith([sig('new', RECENT)])
    expect(applyTemporalDecay(d, NOW)).toBe(0)
    expect(d.learning_loop.temporal_decay_applied).toBe(false)
  })

  it('the SQL cutoff is the same 18 months, as a date', () => {
    expect(decayCutoff(NOW)).toBe(new Date(NOW - 540 * DAY).toISOString().slice(0, 10))
  })
})

// ── The cron ──────────────────────────────────────────────────────────────────

const io = vi.hoisted(() => ({
  due: [] as string[],
  rpcError: null as null | { message: string },
  rpcArgs: [] as unknown[],
  dnas: new Map<string, unknown>(),
  saved: [] as string[],
}))
vi.mock('@/lib/auth-guard', () => ({ isCronAuthorized: () => true, logAuthFailure: () => {} }))
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    rpc: async (name: string, args: unknown) => { io.rpcArgs.push([name, args]); return { data: io.rpcError ? null : io.due, error: io.rpcError } },
  }),
}))
vi.mock('@/modules/dna/lib/load-save', async (orig) => ({
  ...(await orig<typeof import('@/modules/dna/lib/load-save')>()),
  withDNAUpdate: async (userId: string, mutate: (d: DNASchema) => boolean) => {
    const d = io.dnas.get(userId) as DNASchema | undefined
    if (!d) return 'missing'
    if (!mutate(d)) return 'unchanged'
    io.saved.push(userId)
    return 'saved'
  },
}))

describe('cron/decay reads only the DNAs with a signal due (#457)', () => {
  beforeEach(() => { io.due = []; io.rpcError = null; io.rpcArgs = []; io.dnas.clear(); io.saved = [] })
  const run = async () => {
    const { POST } = await import('@/app/api/cron/decay/route')
    return (await POST(new Request('http://t/api/cron/decay', { method: 'POST' }) as never)).json()
  }

  it('asks the database for the due users with the 18-month cutoff, decays them and bumps the version', async () => {
    const d = dnaWith([sig('old', OLD)])
    io.dnas.set('u1', d); io.due = ['u1']
    const before = d.metadata.taste_version
    expect(await run()).toEqual({ ok: true, users_processed: 1, signals_decayed: 1 })
    expect(io.rpcArgs).toEqual([['users_due_for_decay', { p_cutoff: decayCutoff() }]])
    expect(io.saved).toEqual(['u1'])
    expect(d.metadata.taste_version).toBe(before + 1)
    expect(d.metadata.last_updated).not.toBe(createBlankDNA('u1').metadata.last_updated)
  })

  it('a night with nobody due reads no DNA and writes nothing', async () => {
    io.dnas.set('u1', dnaWith([sig('new', RECENT)]))
    expect(await run()).toEqual({ ok: true, users_processed: 0, signals_decayed: 0 })
    expect(io.saved).toEqual([])
  })

  it("the function's error is a 500, nothing written", async () => {
    io.rpcError = { message: 'function users_due_for_decay does not exist' }
    expect(await run()).toMatchObject({ ok: false })
    expect(io.saved).toEqual([])
  })
})
