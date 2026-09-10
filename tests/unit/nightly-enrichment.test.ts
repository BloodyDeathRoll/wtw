import { describe, it, expect, vi, beforeEach } from 'vitest'
import { APICallError } from 'ai'
import { recordMistralCall, resetMistralCallCount } from '@/lib/mistral-batch'

// The nightly loop must survive a TRANSIENT Mistral 429 and still stop dead on
// a spent key, and honour a per-run call budget throughout.
// 2026-09-04: it ran 15 of 15 failing attempts per call, two nights, into a key
// the live app also needed — so a run of 429s through a cooldown must stop it.
// 2026-09-10: ONE 429 after 236 good calls ended the phase with 96 of 300
// enriched and 1,417 pending — so a single 429 must NOT.

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
// `selectErrors[table]` is a queue of failures to hand back first: each
// awaited select shifts one and resolves { data: null, error } until it runs
// dry, then the rows come back as normal.
const tables: Record<string, unknown[]> = { titles: [], crew_members: [] }
const selectErrors: Record<string, string[]> = { titles: [], crew_members: [] }
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from(table: string) {
      const builder: Record<string, unknown> = {
        then(resolve: (v: { data: unknown[] | null; error: { message: string } | null }) => void) {
          const message = selectErrors[table]?.shift()
          if (message) resolve({ data: null, error: { message } })
          else resolve({ data: tables[table] ?? [], error: null })
        },
      }
      for (const m of ['select', 'is', 'in', 'order', 'limit']) builder[m] = () => builder
      return builder
    },
  }),
}))

const rateLimit = (responseHeaders?: Record<string, string>) =>
  new APICallError({
    message: 'Rate limit exceeded',
    url: 'https://api.mistral.ai/v1/chat/completions',
    requestBodyValues: {},
    statusCode: 429,
    responseHeaders,
  })

const title = (id: number) => ({ tmdb_id: String(id), title: `T${id}`, type: 'movie' })
const crew = (id: number) => ({ tmdb_person_id: String(id), name: `P${id}`, primary_role: 'director' })

beforeEach(() => {
  resetMistralCallCount()
  enrichTitle.mockReset()
  buildLineage.mockReset()
  tables.titles = [title(1), title(2), title(3)]
  tables.crew_members = [crew(10), crew(11)]
  selectErrors.titles = []
  selectErrors.crew_members = []
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

async function run(options?: { maxMistralCalls?: number; rateLimitCooldownMs?: number; maxCooldownMs?: number }) {
  const { runNightlyEnrichment } = await import('@/modules/engine/enrichment/nightly-enrichment')
  return runNightlyEnrichment(options)
}

describe('runNightlyEnrichment — rate limit', () => {
  it('cools down and retries the SAME title after a transient 429', async () => {
    let attempts = 0
    enrichTitle.mockImplementation(async () => {
      recordMistralCall()
      attempts++
      if (attempts === 1) throw rateLimit()
      recordMistralCall()
      return true
    })
    buildLineage.mockImplementation(async () => { recordMistralCall(); return true })
    const report = await run({ rateLimitCooldownMs: 0 })
    // 3 titles + one retry of the first. The retry is the same title, not the next.
    expect(enrichTitle).toHaveBeenCalledTimes(4)
    expect(enrichTitle).toHaveBeenNthCalledWith(1, '1', 'movie')
    expect(enrichTitle).toHaveBeenNthCalledWith(2, '1', 'movie')
    expect(buildLineage).toHaveBeenCalledTimes(2)
    expect(report.rate_limited).toBe(false)
    expect(report.titles_processed).toBe(3)
    expect(report.titles_failed).toBe(0)
    expect(report.mistral_calls).toBe(9) // 1 burnt + 2+2+2 titles + 2 lineage
  }, 15_000)

  it('stops after three consecutive 429s through a cooldown: no lineage', async () => {
    enrichTitle.mockImplementation(async () => {
      recordMistralCall()
      throw rateLimit()
    })
    const report = await run({ rateLimitCooldownMs: 0 })
    expect(enrichTitle).toHaveBeenCalledTimes(3)
    expect(buildLineage).not.toHaveBeenCalled()
    expect(report.rate_limited).toBe(true)
    expect(report.titles_failed).toBe(1)
    expect(report.titles_processed).toBe(0)
    expect(report.mistral_calls).toBe(3)
  })

  it('a success resets the run, so scattered 429s never read as the wall', async () => {
    let n = 0
    enrichTitle.mockImplementation(async () => {
      recordMistralCall()
      n++
      if (n % 2 === 1) throw rateLimit() // every title 429s once, then succeeds
      recordMistralCall()
      return true
    })
    buildLineage.mockImplementation(async () => { recordMistralCall(); return true })
    const report = await run({ rateLimitCooldownMs: 0 })
    expect(enrichTitle).toHaveBeenCalledTimes(6)
    expect(report.rate_limited).toBe(false)
    expect(report.titles_processed).toBe(3)
  }, 15_000)

  it("waits what the 429's retry-after asked for, not the default minute", async () => {
    tables.titles = [title(1)]
    tables.crew_members = []
    enrichTitle
      .mockImplementationOnce(async () => { recordMistralCall(); throw rateLimit({ 'Retry-After': '1' }) })
      .mockImplementation(async () => { recordMistralCall(); recordMistralCall(); return true })
    const started = Date.now()
    const report = await run() // no cooldown override: the default is 60s
    expect(Date.now() - started).toBeGreaterThanOrEqual(900)
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('cooling down 1s'))
    expect(report.rate_limited).toBe(false)
    expect(report.titles_processed).toBe(1)
  }, 15_000)

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

describe('runNightlyEnrichment — what the 429 streak counts', () => {
  // The counter is 429s since the last SUCCESS. Two consequences are deliberate
  // and were untested, so they are pinned here rather than left to the name.
  it('an ordinary failure does not clear the streak', async () => {
    enrichTitle
      .mockImplementationOnce(async () => { recordMistralCall(); throw rateLimit() })
      .mockImplementationOnce(async () => { throw new Error('Failed to update narrative for 2') })
      .mockImplementation(async () => { recordMistralCall(); throw rateLimit() })
    const report = await run({ rateLimitCooldownMs: 0 })
    // 429 (title 1) -> cooldown -> 429 (title 1 again) is 2; the ordinary
    // failure on title 2 leaves it at 2; the next 429 is the third and the wall.
    expect(report.rate_limited).toBe(true)
    expect(report.titles_failed).toBe(2) // the ordinary one, and the wall
    expect(buildLineage).not.toHaveBeenCalled()
  })

  it('the streak carries from the titles phase into the crew phase', async () => {
    // Same key, same wall: a 429 in phase 1 is evidence about phase 2.
    tables.titles = [title(1)]
    enrichTitle
      // 429 (streak 1) -> cooldown -> ordinary failure, which ends the item
      // WITHOUT clearing the streak. Phase 1 leaves the crew phase at 1.
      .mockImplementationOnce(async () => { recordMistralCall(); throw rateLimit() })
      .mockImplementationOnce(async () => { throw new Error('Failed to update narrative for 1') })
    buildLineage.mockImplementation(async () => { recordMistralCall(); throw rateLimit() })
    const report = await run({ rateLimitCooldownMs: 0 })
    expect(report.titles_failed).toBe(1)
    // Two more 429s reach the wall, not three: the streak came in at 1.
    expect(buildLineage).toHaveBeenCalledTimes(2)
    expect(report.rate_limited).toBe(true)
  })
})

describe('runNightlyEnrichment — cooldown ceiling', () => {
  it('maxCooldownMs caps what a retry-after can ask for', async () => {
    // The cron route sets this because it runs under a 300s kill; without the
    // cap a single retry-after would eat the whole budget mid-sleep.
    tables.titles = [title(1)]
    tables.crew_members = []
    enrichTitle
      .mockImplementationOnce(async () => { recordMistralCall(); throw rateLimit({ 'retry-after': '600' }) })
      .mockImplementation(async () => { recordMistralCall(); recordMistralCall(); return true })
    const started = Date.now()
    const report = await run({ maxCooldownMs: 50 })
    expect(Date.now() - started).toBeLessThan(5_000) // not 600s
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('cooling down 0s'))
    expect(report.titles_processed).toBe(1)
    expect(report.rate_limited).toBe(false)
  })
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

  it('a 429 retry that would exceed the budget stops instead of overspending', async () => {
    enrichTitle.mockImplementation(async () => { recordMistralCall(); throw rateLimit() })
    // A 429 on extraction spends 1 call (the embedding never fires). Budget 2:
    // that leaves 1, under TITLE_COST — so the cooldown retry must not happen,
    // and a run cut short by the budget must not read as the rate-limit wall.
    const report = await run({ maxMistralCalls: 2, rateLimitCooldownMs: 0 })
    expect(enrichTitle).toHaveBeenCalledTimes(1)
    expect(report.budget_exhausted).toBe(true)
    expect(report.rate_limited).toBe(false)
    expect(report.mistral_calls).toBe(1)
  })

  it('a budget of zero makes no call at all', async () => {
    enrichTitle.mockImplementation(async () => { recordMistralCall(); return true })
    const report = await run({ maxMistralCalls: 0 })
    expect(enrichTitle).not.toHaveBeenCalled()
    expect(report.budget_exhausted).toBe(true)
    expect(report.mistral_calls).toBe(0)
  })
})

describe('runNightlyEnrichment — pending-queue select failure', () => {
  // The select used to discard its error: one transient Supabase failure read
  // as an empty backlog and the caller stopped with budget unspent.
  it('retries a transient select failure and then processes the queue', async () => {
    selectErrors.titles = ['TypeError: fetch failed']
    enrichTitle.mockImplementation(async () => { recordMistralCall(); recordMistralCall(); return true })
    buildLineage.mockImplementation(async () => { recordMistralCall(); return true })
    const report = await run()
    expect(enrichTitle).toHaveBeenCalledTimes(3)
    expect(buildLineage).toHaveBeenCalledTimes(2)
    expect(report.titles_processed).toBe(3)
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('titles queue select failed (attempt 1/3)'))
  }, 15_000)

  it('throws instead of reporting an empty backlog when the select keeps failing', async () => {
    selectErrors.titles = ['TypeError: fetch failed', 'TypeError: fetch failed', 'TypeError: fetch failed']
    enrichTitle.mockImplementation(async () => { recordMistralCall(); return true })
    await expect(run()).rejects.toThrow('titles queue select failed 3 times')
    expect(enrichTitle).not.toHaveBeenCalled()
    expect(buildLineage).not.toHaveBeenCalled()
  }, 15_000)

  it('keeps the title counts when only the crew select keeps failing', async () => {
    // Phase 1 spent real calls and wrote rows; the caller needs those numbers.
    selectErrors.crew_members = ['TypeError: fetch failed', 'TypeError: fetch failed', 'TypeError: fetch failed']
    enrichTitle.mockImplementation(async () => { recordMistralCall(); recordMistralCall(); return true })
    buildLineage.mockImplementation(async () => { recordMistralCall(); return true })
    const report = await run()
    expect(enrichTitle).toHaveBeenCalledTimes(3)
    expect(buildLineage).not.toHaveBeenCalled()
    expect(report.titles_processed).toBe(3)
    expect(report.mistral_calls).toBe(6)
    expect(report.crew_queue_failed).toBe(true)
  }, 15_000)
})
