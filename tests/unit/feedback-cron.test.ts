// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

// v3 Y2: the nightly retry is CRON_SECRET-only, and answers GET (Vercel's cron) as well as POST.

const retry = vi.fn(async () => ({ tried: 2, sent: 1 }))
vi.mock('@/lib/feedback', () => ({ retryUnsent: () => retry() }))
vi.mock('@/lib/auth-guard', async (orig) => ({ ...(await orig<typeof import('@/lib/auth-guard')>()), logAuthFailure: () => {} }))
process.env.CRON_SECRET = 'cs'
vi.spyOn(console, 'log').mockImplementation(() => {})
const { GET, POST } = await import('@/app/api/cron/feedback/route')
const req = (auth?: string) => new Request('http://x/api/cron/feedback', { headers: auth ? { authorization: auth } : {} }) as never

describe('/api/cron/feedback', () => {
  it('without the secret: 401, nothing sent', async () => {
    expect((await GET(req())).status).toBe(401)
    expect((await GET(req('Bearer nope'))).status).toBe(401)
    expect(retry).not.toHaveBeenCalled()
  })
  it('with it: retries the unsent notes, on GET and POST', async () => {
    expect(await (await GET(req('Bearer cs'))).json()).toEqual({ ok: true, tried: 2, sent: 1 })
    expect((await POST(req('Bearer cs'))).status).toBe(200)
  })
})
