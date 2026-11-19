// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// v3 Y2: POST /api/feedback saves the note, then emails it after the response.

const io = vi.hoisted(() => ({
  sub: 'u1' as string | null, configured: true, limited: null as Response | null, saveFails: false,
  inserted: [] as Record<string, unknown>[], afterTasks: [] as (() => Promise<unknown>)[], emailed: 0, marked: [] as unknown[],
}))
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (t: () => Promise<unknown>) => { io.afterTasks.push(t) } }))
vi.mock('@/lib/auth-guard', () => ({ logAuthFailure: () => {} }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getClaims: async () => ({ data: io.sub ? { claims: { sub: io.sub, email: 'd@example.com', user_metadata: { full_name: 'Dana' } } } : null, error: null }) } }) }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: async () => io.limited }))
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ from: () => ({
  insert: (row: Record<string, unknown>) => ({ select: () => ({ single: async () => {
    if (io.saveFails) return { data: null, error: { message: 'db down' } }
    io.inserted.push(row); return { data: { id: 7, body: row.body, created_at: '2026-11-19T10:00:00Z', user_agent: row.user_agent }, error: null }
  } }) }),
}) }) }))
vi.mock('@/lib/feedback', async (orig) => ({
  ...(await orig<typeof import('@/lib/feedback')>()),
  feedbackConfigured: () => io.configured,
  emailFeedback: async () => { io.emailed++; return true },
  markAttempt: async (...a: unknown[]) => { io.marked.push(a) },
}))

const { POST } = await import('@/app/api/feedback/route')
const post = (body: unknown) => POST(new Request('http://x/api/feedback', { method: 'POST', headers: { 'user-agent': 'Android' }, body: JSON.stringify(body) }) as never)

beforeEach(() => {
  Object.assign(io, { sub: 'u1', configured: true, limited: null, saveFails: false, inserted: [], afterTasks: [], emailed: 0, marked: [] })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('POST /api/feedback', () => {
  it('saves the trimmed note, answers ok, then emails it after the response and records the attempt', async () => {
    const res = await post({ body: '  Please add a dark mode toggle.  ' })
    expect(res.status).toBe(200)
    expect(io.inserted).toEqual([{ user_id: 'u1', body: 'Please add a dark mode toggle.', user_agent: 'Android' }])
    expect(io.emailed).toBe(0)
    await Promise.all(io.afterTasks.map(t => t()))
    expect(io.emailed).toBe(1)
    expect(io.marked).toEqual([[7, true, 0]])
  })
  it('signed out: 401, nothing saved', async () => {
    io.sub = null
    expect((await post({ body: 'x' })).status).toBe(401)
    expect(io.inserted).toEqual([])
  })
  it('no email service set up: 503 unavailable (the page shows the red line)', async () => {
    io.configured = false
    expect((await post({ body: 'x' })).status).toBe(503)
  })
  it('empty or over 2,000 characters: refused', async () => {
    expect((await post({ body: '   ' })).status).toBe(400)
    expect((await post({ body: 'a'.repeat(2001) })).status).toBe(400)
    expect(io.inserted).toEqual([])
  })
  it('over the hourly limit: the limiter\'s answer, nothing saved', async () => {
    io.limited = new Response(null, { status: 429 })
    expect((await post({ body: 'sixth note' })).status).toBe(429)
    expect(io.inserted).toEqual([])
  })
  it('a failed save: 500, so the page keeps the note and says so', async () => {
    io.saveFails = true
    expect((await post({ body: 'x' })).status).toBe(500)
  })
})
