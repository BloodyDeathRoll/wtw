import { describe, it, expect, vi, beforeEach } from 'vitest'
import { APICallError } from 'ai'
import { recordMistralCall, resetMistralCallCount } from '@/lib/mistral-batch'

// The nightly loop must stop on the FIRST Mistral 429 and honour a per-run
// call budget. 2026-09-04: it ran 15 of 15 failing attempts per call, two
// nights, into a key the live app also needed.

const enrichTitle = vi.fn()
const buildLineage = vi.fn()
vi.mock('@/modules/engine/enrichment/enrich-title-narrative', () => ({
  enrichTitleWithNarrative: (...args: unknown[]) => enrichTitle(...args),
}))
vi.mock('@/modules/engine/enrichment/build-lineage-graph', () => ({
  buildLineageGraph: (...args: unknown[]) => buildLineage(...args),
}))

// Minimal chainable Supabase stub: every method returns the builder, awaiting
// it resolves to the rows for the table `from()` named.
const tables: Record<string, unknown[]> = { titles: [], crew_members: [] }
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from(table: string) {
      const builder: Record<string, unknown> = {
        then(resolve: (v: { data: unknown[] }) => void) {
          resolve({ data: tables[table] ?? [] })
        },
      }
      for (const m of ['select', 'is', 'in', 'order', 'limit']) builder[m] = () => builder
      return builder
    },
  }),
}))

const rateLimit = () =>
  new APICallError({
    message: 'Rate limit exceeded',
    url: 'https://api.mistral.ai/v1/chat/completions',
    requestBodyValues: {},
    statusCode: 429,
  })

const title = (id: number) => ({ tmdb_id: String(id), title: `T${id}`, type: 'movie' })
const crew = (id: number) => ({ tmdb_person_id: String(id), name: `P${id}`, primary_role: 'director' })

beforeEach(() => {
  resetMistralCallCount()
  enrichTitle.mockReset()
  buildLineage.mockReset()
  tables.titles = [title(1), title(2), title(3)]
  tables.crew_members = [crew(10), crew(11)]
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

async function run(options?: { maxMistralCalls?: number }) {
  const { runNightlyEnrichment } = await import('@/modules/engine/enrichment/nightly-enrichment')
  return runNightlyEnrichment(options)
}

describe('runNightlyEnrichment — rate limit', () => {
  it('stops after the first 429: no further titles, no lineage', async () => {
    enrichTitle.mockImplementation(async () => {
      recordMistralCall()
      throw rateLimit()
    })
    const report = await run()
    expect(enrichTitle).toHaveBeenCalledTimes(1)
    expect(buildLineage).not.toHaveBeenCalled()
    expect(report.rate_limited).toBe(true)
    expect(report.titles_failed).toBe(1)
    expect(report.titles_processed).toBe(0)
    expect(report.mistral_calls).toBe(1)
  })

  it('keeps going on an ordinary failure', async () => {
    enrichTitle
      .mockImplementationOnce(async () => { throw new Error('Failed to update narrative for 1') })
      .mockImplementation(async () => { recordMistralCall(); recordMistralCall(); return true })
    buildLineage.mockImplementation(async () => { recordMistralCall(); return true })
    const report = await run()
    expect(enrichTitle).toHaveBeenCalledTimes(3)
    expect(buildLineage).toHaveBeenCalledTimes(2)
    expect(report.rate_limited).toBe(false)
    expect(report.titles_failed).toBe(1)
    expect(report.titles_processed).toBe(2)
    expect(report.mistral_calls).toBe(6)
  }, 15_000)
})

describe('runNightlyEnrichment — call budget', () => {
  it('stops before the title that would exceed the budget and skips lineage', async () => {
    enrichTitle.mockImplementation(async () => { recordMistralCall(); recordMistralCall(); return true })
    buildLineage.mockImplementation(async () => { recordMistralCall(); return true })
    const report = await run({ maxMistralCalls: 3 })
    // Title costs 2: one fits in 3, the second would need 4.
    expect(enrichTitle).toHaveBeenCalledTimes(1)
    expect(buildLineage).not.toHaveBeenCalled()
    expect(report.budget_exhausted).toBe(true)
    expect(report.rate_limited).toBe(false)
    expect(report.titles_processed).toBe(1)
    expect(report.mistral_calls).toBe(2)
  })

  it('a budget of zero makes no call at all', async () => {
    enrichTitle.mockImplementation(async () => { recordMistralCall(); return true })
    const report = await run({ maxMistralCalls: 0 })
    expect(enrichTitle).not.toHaveBeenCalled()
    expect(report.budget_exhausted).toBe(true)
    expect(report.mistral_calls).toBe(0)
  })
})
