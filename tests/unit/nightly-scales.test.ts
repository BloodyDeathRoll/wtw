import { describe, it, expect, vi, beforeEach } from 'vitest'
import { APICallError } from 'ai'
import { recordMistralCall, resetMistralCallCount } from '@/lib/mistral-batch'

// P1-D3: the nightly job puts new titles on the taste scales (opt-in), inside
// the same call budget and 429 handling as enrichment, then finalises them.

vi.mock('@/modules/engine/enrichment/enrich-title-narrative', () => ({ enrichTitleWithNarrative: async () => true }))
vi.mock('@/modules/engine/enrichment/build-lineage-graph', () => ({ buildLineageGraph: async () => false }))

const io = vi.hoisted(() => ({
  unscored: [] as { id: number; tmdb_id: string; type: string }[],
  unfinalised: [] as { id: number; tmdb_id: string; type: string }[],
  scored: [] as number[][],          // ids per scale call
  finalised: [] as number[],
  failNext429: 0,
  updates: [] as { id: number; patch: Record<string, unknown> }[],
}))

vi.mock('@/lib/taste-scales/catalogue', () => ({
  SCALE_BATCH: 10,
  SCALE_COLS: 'id, tmdb_id, type',
  scoreScaleBatch: async (rows: { id: number }[]) => {
    recordMistralCall()
    if (io.failNext429 > 0) {
      io.failNext429--
      throw new APICallError({ message: 'Rate limit exceeded', url: 'x', requestBodyValues: {}, statusCode: 429 })
    }
    io.scored.push(rows.map(r => r.id))
    return rows.length
  },
  finaliseScaleRow: async (r: { id: number }) => {
    io.finalised.push(r.id)
    return { update: { taste_vec: '[0]' }, episodeLookup: false, episodeLookupFailed: false }
  },
}))

// Tells the phase's two `titles` queries apart: unscored (taste_raw IS NULL)
// and scored-but-not-finalised (taste_raw NOT NULL, taste_vec IS NULL).
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from(table: string) {
      const q: { table: string; rawNull?: boolean; rawNotNull?: boolean; enrichedNull?: boolean; updateId?: number; patch?: Record<string, unknown> } = { table }
      const b: Record<string, unknown> = {
        then(resolve: (v: unknown) => void) {
          if (q.patch) { io.updates.push({ id: q.updateId!, patch: q.patch }); return resolve({ data: null, error: null }) }
          if (table !== 'titles') return resolve({ data: [], error: null })
          if (q.enrichedNull) return resolve({ data: [], error: null })          // enrichment queue: empty
          if (q.rawNull) return resolve({ data: io.unscored, error: null })
          if (q.rawNotNull) return resolve({ data: io.unfinalised, error: null })
          return resolve({ data: [], error: null })
        },
      }
      b.select = () => b
      b.order = () => b
      b.limit = () => b
      b.in = () => b
      b.is = (col: string) => { if (col === 'taste_raw') q.rawNull = true; if (col === 'enriched_at') q.enrichedNull = true; return b }
      b.not = (col: string) => { if (col === 'taste_raw') q.rawNotNull = true; return b }
      b.update = (patch: Record<string, unknown>) => { q.patch = patch; return b }
      b.eq = (_c: string, v: number) => { q.updateId = v; return b }
      return b
    },
  }),
}))

const rows = (n: number, from = 1) => Array.from({ length: n }, (_, i) => ({ id: from + i, tmdb_id: String(from + i), type: 'movie' }))

beforeEach(() => {
  resetMistralCallCount()
  io.unscored = rows(25)
  io.unfinalised = rows(25)
  io.scored = []
  io.finalised = []
  io.failNext429 = 0
  io.updates = []
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

async function run(options: Record<string, unknown>) {
  const { runNightlyEnrichment } = await import('@/modules/engine/enrichment/nightly-enrichment')
  return runNightlyEnrichment(options)
}

describe('runNightlyEnrichment — taste scales (P1-D3)', () => {
  it('is off unless asked: the serverless routes never run it', async () => {
    const r = await run({})
    expect(io.scored).toEqual([])
    expect(r).toMatchObject({ scales_scored: 0, scales_finalised: 0 })
  })

  it('scores new titles 10 per call, then finalises the scored ones', async () => {
    const r = await run({ scales: true, scaleSpacingMs: 0 })
    expect(io.scored.map(b => b.length)).toEqual([10, 10, 5])
    expect(r.scales_scored).toBe(25)
    expect(io.finalised).toHaveLength(25)
    expect(r.scales_finalised).toBe(25)
    expect(io.updates.every(u => u.patch.taste_vec === '[0]')).toBe(true)
    expect(r.mistral_calls).toBe(3)
  })

  it('stays inside the call budget', async () => {
    const r = await run({ scales: true, scaleSpacingMs: 0, maxMistralCalls: 2 })
    expect(io.scored).toHaveLength(2)
    expect(r.budget_exhausted).toBe(true)
  })

  it('a 429 cools down and retries the same batch', async () => {
    io.failNext429 = 1
    const r = await run({ scales: true, scaleSpacingMs: 0, rateLimitCooldownMs: 0 })
    expect(io.scored[0]).toEqual(rows(10).map(x => x.id))
    expect(r.scales_scored).toBe(25)
    expect(r.rate_limited).toBe(false)
  })

  it('three 429s in a row: the key is spent, the run stops', async () => {
    io.failNext429 = 3
    const r = await run({ scales: true, scaleSpacingMs: 0, rateLimitCooldownMs: 0 })
    expect(io.scored).toEqual([])
    expect(r.rate_limited).toBe(true)
    expect(r.scales_failed).toBe(10)
  })
})
