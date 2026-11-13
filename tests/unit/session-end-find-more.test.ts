import { describe, it, expect, vi, beforeEach } from 'vitest'

// POST /api/session/end with nothing new to merge and a warm, clean cache:
//   - a plain call (warm-up, leave-cards) is the no-op `unchanged`;
//   - `more: true` ("Find more") builds the NEXT batch at the same
//     taste_version — the fingerprint update (version bump) is skipped.

const dnaRow = { metadata: { taste_version: 7, total_sessions: 3 }, learning_loop: { recommendation_history: [] } }
const table = (name: string) => {
  const rows: Record<string, unknown> = {
    conversations: { id: 'c1', user_id: 'u1' },
    users: { dna: dnaRow },
  }
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order', 'update']) chain[m] = () => chain
  chain.single = async () => ({ data: rows[name] ?? null })
  chain.then = (res: (v: unknown) => void) => res({ data: [] })
  return chain
}
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ from: table }) }))
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ from: table }) }))
vi.mock('@/lib/supabase/auth-user', () => ({ getAuthUser: async () => ({ id: 'u1', email: 'a@b.c' }) }))
vi.mock('@/lib/auth-guard', () => ({ logAuthFailure: () => {} }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: async () => null }))
vi.mock('@/lib/conversations', () => ({ endConversation: async () => {} }))
vi.mock('@/modules/dna/lib/load-save', () => ({ invalidateDNACache: async () => {} }))
const analyzeSession = vi.fn()
vi.mock('@/modules/session/analyze-session', () => ({ analyzeSession }))
vi.mock('@/modules/session/feedback-signals', () => ({ foldRatedHistoryIntoSummary: async () => 0 }))
const updateSchemaFromSession = vi.fn()
vi.mock('@/modules/dna/update-from-session', () => ({ updateSchemaFromSession }))
const generateRecommendations = vi.fn(async () => [{ tmdb_id: 9, type: 'movie' }, { tmdb_id: 10, type: 'movie' }])
vi.mock('@/modules/engine', () => ({ generateRecommendations }))
const adoptPendingBatch = vi.fn(async () => null)
vi.mock('@/modules/engine/pipeline/precompute', () => ({ adoptPendingBatch }))
vi.mock('@/modules/engine/pipeline/step8-cache', () => ({
  getCachedRecommendations: async () => [{ tmdb_id: 1, type: 'movie' }, { tmdb_id: 2, type: 'tv' }],
}))

const firstPage = { recommendations: [{ id: 'movie:9' }], next_offset: 6, has_more: true, source: 'find-more', taste_version: 7 }
const buildRecPage = vi.fn(async () => firstPage)
vi.mock('@/lib/rec-page', () => ({ buildRecPage, getRemovedKeys: async () => new Set<string>() }))

const { POST } = await import('@/app/api/session/end/route')
const { NextRequest } = await import('next/server')

const post = (body: Record<string, unknown>) =>
  POST(new NextRequest('http://t/api/session/end', { method: 'POST', body: JSON.stringify({ conversation_id: 'c1', skip_transcript: true, ...body }) }))

beforeEach(() => vi.clearAllMocks())

describe('session/end with nothing to merge', () => {
  it('without `more`: unchanged, nothing generated, no fingerprint update', async () => {
    const res = await post({})
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, unchanged: true, rec_count: 0, taste_version: 7 })
    expect(generateRecommendations).not.toHaveBeenCalled()
    expect(updateSchemaFromSession).not.toHaveBeenCalled()
  })

  it('with `more`: the next batch is built at the same taste_version, no fingerprint update', async () => {
    const res = await post({ more: true })
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, rec_count: 2, taste_version: 7 })
    expect(body.unchanged).toBeUndefined()
    expect(adoptPendingBatch).toHaveBeenCalledWith('u1', dnaRow, expect.anything())
    expect(generateRecommendations).toHaveBeenCalledWith('u1', undefined, expect.objectContaining({ dna: dnaRow, skipCacheRead: true }))
    expect(updateSchemaFromSession).not.toHaveBeenCalled()
  })

  it('with `more`: a precomputed batch is adopted instead of generating', async () => {
    adoptPendingBatch.mockResolvedValueOnce([{ tmdb_id: 5, type: 'movie' }] as never)
    expect(await (await post({ more: true })).json()).toMatchObject({ rec_count: 1 })
    expect(generateRecommendations).not.toHaveBeenCalled()
  })

  it('with `more`: an empty batch is told apart from a failed build', async () => {
    generateRecommendations.mockResolvedValueOnce([])
    expect(await (await post({ more: true })).json()).toMatchObject({ rec_count: 0, warning: 'Next batch came back empty' })
  })

  it('with `more`: a generation failure is a 200 with a warning, never a 500', async () => {
    generateRecommendations.mockRejectedValueOnce(new Error('pipeline down'))
    const res = await post({ more: true })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, rec_count: 0, warning: 'Next batch could not be built' })
  })
})

// 2026-11-13: "Find more" right after a rating took 15 s. The rating is already
// in the signals (light merge), so the cache holding that title is no reason
// for the fingerprint update (3.4 s measured, only a version bump). And the
// first page of cards rides in the response instead of a second request.
describe('session/end `more` after a rating', () => {
  const rated = [{ recommended: 'movie:1', tmdb_id: '1', rating: 'liked' }]

  it('the cache holds a rated title: next batch at the same version, no fingerprint update', async () => {
    dnaRow.learning_loop.recommendation_history = rated as never
    try {
      const body = await (await post({ more: true })).json()
      expect(body).toMatchObject({ ok: true, rec_count: 2, taste_version: 7 })
      expect(generateRecommendations).toHaveBeenCalledWith('u1', undefined, expect.objectContaining({ dna: dnaRow, skipCacheRead: true }))
      expect(updateSchemaFromSession).not.toHaveBeenCalled()
    } finally {
      dnaRow.learning_loop.recommendation_history = []
    }
  })

  it('without `more`, the same cache still takes the full update', async () => {
    dnaRow.learning_loop.recommendation_history = rated as never
    updateSchemaFromSession.mockResolvedValueOnce({ metadata: { taste_version: 8 } })
    try {
      expect(await (await post({})).json()).toMatchObject({ ok: true, taste_version: 8 })
      expect(updateSchemaFromSession).toHaveBeenCalled()
    } finally {
      dnaRow.learning_loop.recommendation_history = []
    }
  })

  it('the first page of the new batch comes back in the response', async () => {
    const body = await (await post({ more: true })).json()
    expect(body.page).toEqual(firstPage)
    expect(buildRecPage).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', dna: dnaRow, start: 0 }))
  })

  it('a failed page is left out, the batch still counts', async () => {
    buildRecPage.mockRejectedValueOnce(new Error('titles down'))
    const body = await (await post({ more: true })).json()
    expect(body).toMatchObject({ ok: true, rec_count: 2 })
    expect(body.page).toBeUndefined()
  })

  it('no page without `more`', async () => {
    expect((await (await post({})).json()).page).toBeUndefined()
    expect(buildRecPage).not.toHaveBeenCalled()
  })
})

describe('session/end never reads the chat (P1-C1)', () => {
  it('a real session end does not analyse the transcript, and nothing from it reaches the merge', async () => {
    const res = await post({ skip_transcript: false })
    expect(res.status).toBe(200)
    expect(analyzeSession).not.toHaveBeenCalled()
    const body = await res.json()
    expect(body.extraction_failed).toBeUndefined()
  })
})
