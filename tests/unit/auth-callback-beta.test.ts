import { describe, it, expect, vi, beforeEach } from 'vitest'

// Closed beta (migration 0040): /auth/callback lets a sign-in through only for
// an email on beta_allowlist, signs anyone else out, and shows the refusal.

const state = {
  exchange: { data: { user: { email: 'ok@example.com' } }, error: null } as { data: unknown; error: unknown },
  rpc: { data: true, error: null } as { data: unknown; error: unknown },
  signOut: vi.fn(async () => ({ error: null })),
  rpcArgs: [] as unknown[],
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { exchangeCodeForSession: async () => state.exchange, signOut: state.signOut },
  }),
}))
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    rpc: async (...args: unknown[]) => { state.rpcArgs.push(args); return state.rpc },
  }),
}))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))

const { GET } = await import('@/app/auth/callback/route')
const call = (qs: string) => GET(new Request(`https://wtw.test/auth/callback?${qs}`))

beforeEach(() => {
  state.exchange = { data: { user: { email: 'ok@example.com' } }, error: null }
  state.rpc = { data: true, error: null }
  state.signOut.mockClear()
  state.rpcArgs = []
})

describe('auth callback, closed beta', () => {
  it('an approved email goes on to the app', async () => {
    const res = await call('code=c&next=/watchlist')
    expect(res.headers.get('location')).toBe('https://wtw.test/watchlist')
    expect(state.rpcArgs).toEqual([['is_beta_approved', { p_email: 'ok@example.com' }]])
    expect(state.signOut).not.toHaveBeenCalled()
  })

  it('an email off the list is signed out and told why', async () => {
    state.rpc = { data: false, error: null }
    const res = await call('code=c')
    expect(res.headers.get('location')).toBe('https://wtw.test/login?error=not-approved')
    expect(state.signOut).toHaveBeenCalledOnce()
  })

  it('a failed list check fails closed', async () => {
    state.rpc = { data: null, error: { message: 'down' } }
    const res = await call('code=c')
    expect(res.headers.get('location')).toBe('https://wtw.test/login?error=not-approved')
    expect(state.signOut).toHaveBeenCalledOnce()
  })

  it('a sign-up the Auth hook refused shows the same message', async () => {
    const res = await call('error=access_denied&error_description=not_approved%3A+this+email+is+not+on+the+closed+beta+list')
    expect(res.headers.get('location')).toBe('https://wtw.test/login?error=not-approved')
  })

  it('any other failure stays the generic auth error', async () => {
    state.exchange = { data: { user: null }, error: { message: 'bad code' } }
    const res = await call('code=c')
    expect(res.headers.get('location')).toBe('https://wtw.test/login?error=auth')
  })
})
