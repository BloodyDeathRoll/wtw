import { describe, it, expect, vi } from 'vitest'

// GET /api/recommendations/generate: the client sends the taste_version its
// offset belongs to. The live batch is replaced under a scrolling user
// (refresh-batch.ts); an offset carried into the replacement skipped its top
// (positions 42–49 of a batch whose 42 best matches were never shown, seen
// live 2026-11-05). When the version moved, the walk restarts at 0.

const state = vi.hoisted(() => ({ version: 7, served: [] as string[][] }))

vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: (fn: () => unknown) => { void fn() },
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }))
vi.mock('@/lib/supabase/auth-user', () => ({ getAuthUser: async () => ({ id: 'u1' }) }))
vi.mock('@/lib/auth-guard', () => ({ logAuthFailure: () => {} }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: async () => null }))
vi.mock('@/modules/engine', () => ({ generateRecommendations: async () => [] }))
vi.mock('@/modules/engine/enrichment/ensure-watch-providers', () => ({ ensureWatchProviders: async () => {} }))
vi.mock('@/modules/engine/pipeline/step8-cache', () => ({
  getCachedRecommendations: async () => Array.from({ length: 50 }, (_, i) => ({
    tmdb_id: String(100 + i), type: 'movie', title: `t${i}`, composite_score: 1 - i / 100,
    explanation: '', is_stretch_pick: false, generated_at: '', fingerprint_version: state.version,
  })),
}))
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table === 'users') return { select: () => ({ eq: () => ({ single: async () => ({ data: { dna: dnaAt(state.version) }, error: null }) }) }) }
      return { select: () => ({ eq: async () => ({ data: [], error: null }), in: async () => ({ data: [], error: null }) }) }
    },
    rpc: async (_name: string, args: { p_keys: string[] }) => { state.served.push(args.p_keys); return { error: null } },
  }),
}))

const { createBlankDNA } = await import('@/modules/dna/blank-dna')
const dnaAt = (v: number) => { const d = createBlankDNA('u1'); d.metadata.taste_version = v; return d }
const { GET } = await import('@/app/api/recommendations/generate/route')

const page = async (qs: string) => {
  const res = await GET(new Request(`http://t/api/recommendations/generate?type=movies&${qs}`))
  const body = await res.json() as { recommendations: { id: string }[]; next_offset: number; taste_version: number }
  return { status: res.status, ids: body.recommendations.map(r => r.id), next_offset: body.next_offset, taste_version: body.taste_version }
}

describe('GET /api/recommendations/generate — the offset follows the batch', () => {
  it('serves the page at the offset when the version is the one the client has', async () => {
    const r = await page('offset=42&v=7')
    expect(r.ids).toEqual(['movie:142', 'movie:143', 'movie:144', 'movie:145', 'movie:146', 'movie:147'])
    expect(r.next_offset).toBe(48)
    expect(r.taste_version).toBe(7)
  })

  it('restarts from the top when the live batch was replaced underneath', async () => {
    state.version = 8
    const r = await page('offset=42&v=7')
    expect(r.ids).toEqual(['movie:100', 'movie:101', 'movie:102', 'movie:103', 'movie:104', 'movie:105'])
    expect(r.next_offset).toBe(6)
    expect(r.taste_version).toBe(8)
  })

  it('honours the offset when the client sent no version (first page of a view)', async () => {
    const r = await page('offset=6')
    expect(r.ids[0]).toBe('movie:106')
    expect(r.next_offset).toBe(12)
  })
})
