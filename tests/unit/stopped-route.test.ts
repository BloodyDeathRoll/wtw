import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// v3 F4 (FOR-YOU.md DEC-6, #351): the phone reports the cards it stopped on. Only keys in the person's own 20s are
// marked, and only with FOR_YOU_V3 on.

const db = vi.hoisted(() => ({
  user: { id: 'u1' } as { id: string } | null,
  sets: [{ recs: [{ tmdb_id: '603', type: 'movie' }, { tmdb_id: '1399', type: 'tv' }] }] as unknown[],
  rpcs: [] as { name: string; args: Record<string, unknown> }[],
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }))
vi.mock('@/lib/supabase/auth-user', () => ({ getAuthUser: async () => db.user }))
vi.mock('@/lib/auth-guard', () => ({ logAuthFailure: () => {} }))
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: () => ({ select: () => ({ eq: async () => ({ data: db.sets, error: null }) }) }),
    rpc: async (name: string, args: Record<string, unknown>) => { db.rpcs.push({ name, args }); return { error: null } },
  }),
}))

const { POST } = await import('@/app/api/recommendations/stopped/route')
const post = (body: unknown) => POST(new Request('http://t/api/recommendations/stopped', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => { db.user = { id: 'u1' }; db.rpcs.length = 0 })
afterEach(() => { vi.unstubAllEnvs() })

describe('POST /api/recommendations/stopped', () => {
  it('flag off: not there', async () => {
    expect((await post({ keys: ['movie:603'] })).status).toBe(404)
    expect(db.rpcs).toEqual([])
  })

  it('marks only the keys in the person\'s 20s', async () => {
    vi.stubEnv('FOR_YOU_V3', 'true')
    const res = await post({ keys: ['movie:603', 'tv:1399', 'movie:999', 'movie:603', 'nonsense'] })
    expect(await res.json()).toEqual({ marked: 2 })
    expect(db.rpcs).toEqual([{ name: 'mark_stopped_on', args: { p_user_id: 'u1', p_keys: ['movie:603', 'tv:1399'] } }])
  })

  it('needs a signed-in person and a sensible report', async () => {
    vi.stubEnv('FOR_YOU_V3', 'true')
    expect((await post({ keys: Array.from({ length: 41 }, (_, i) => `movie:${i}`) })).status).toBe(400)
    expect((await post({})).status).toBe(400)
    db.user = null
    expect((await post({ keys: ['movie:603'] })).status).toBe(401)
    expect(db.rpcs).toEqual([])
  })
})
