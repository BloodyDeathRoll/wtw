import { describe, it, expect, vi, beforeEach } from 'vitest'

// POST /api/admin/jev-failures: a dev dismissed the Jev failure banner.
// Devs only; the seen marker is the newest failure shown, never a future date.

let user: { id: string; email?: string } | null = null
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user }, error: null }) } }),
}))
vi.mock('@/lib/auth-guard', () => ({ logAuthFailure: () => {} }))
const redis = { set: vi.fn(async () => 'OK') }
vi.mock('@/lib/redis', () => ({ getRedis: () => redis }))

const { POST } = await import('@/app/api/admin/jev-failures/route')
const { NextRequest } = await import('next/server')

const post = (body: unknown) =>
  POST(new NextRequest('http://t/api/admin/jev-failures', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }))

beforeEach(() => { vi.clearAllMocks() })

describe('POST /api/admin/jev-failures', () => {
  it('401 signed out', async () => {
    user = null
    expect((await post({ at: '2026-11-05T12:00:00.000Z' })).status).toBe(401)
    expect(redis.set).not.toHaveBeenCalled()
  })

  it('403 for a signed-in user who is not a dev', async () => {
    user = { id: 'u1', email: 'someone@example.com' }
    expect((await post({ at: '2026-11-05T12:00:00.000Z' })).status).toBe(403)
    expect(redis.set).not.toHaveBeenCalled()
  })

  it('400 without a parseable `at`', async () => {
    user = { id: 'u1', email: 'einhanamer@gmail.com' }
    expect((await post({})).status).toBe(400)
    expect((await post({ at: 'yesterday' })).status).toBe(400)
    expect((await post('not json')).status).toBe(400)
    expect(redis.set).not.toHaveBeenCalled()
  })

  it('204 for a dev: marks seen at the failure shown, email lower-cased', async () => {
    user = { id: 'u1', email: 'EinHanamer@gmail.com' }
    // A past `at`, or the clamp below turns it into "now".
    expect((await post({ at: '2026-11-04T12:00:00.000Z' })).status).toBe(204)
    expect(redis.set).toHaveBeenCalledWith('jev:seen:einhanamer@gmail.com', '2026-11-04T12:00:00.000Z')
  })

  it('an `at` with a timezone offset is stored in canonical UTC form', async () => {
    user = { id: 'u1', email: 'lavi.alon@gmail.com' }
    expect((await post({ at: '2026-11-04T12:00:00+02:00' })).status).toBe(204)
    expect(redis.set).toHaveBeenCalledWith('jev:seen:lavi.alon@gmail.com', '2026-11-04T10:00:00.000Z')
  })

  it('a future `at` is clamped to now', async () => {
    user = { id: 'u1', email: 'eranmanor@gmail.com' }
    const before = new Date().toISOString()
    expect((await post({ at: '2999-01-01T00:00:00.000Z' })).status).toBe(204)
    const [, stored] = redis.set.mock.calls[0] as unknown as [string, string]
    expect(stored >= before && stored <= new Date().toISOString()).toBe(true)
  })
})
