// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'

// <Analytics /> (#464): the first config carries the user id when the session reads in
// time, a slow read still starts GA, and the auth events keep the id current.

const a = { init: vi.fn(), identify: vi.fn(), forget: vi.fn() }
vi.mock('@/lib/analytics', () => ({
  GA_ID: 'G-TEST',
  initAnalytics: (id: string | null) => a.init(id),
  identify: (id: string | null) => a.identify(id),
  forgetOnboarding: () => a.forget(),
}))
vi.mock('next/script', () => ({ default: () => null }))
const signedIn = () => Promise.resolve({ data: { session: { user: { id: 'u1' } } } })
let session: Promise<unknown> = signedIn()
let onAuth: (event: string, s: unknown) => void = () => {}
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: {
    getSession: () => session,
    onAuthStateChange: (cb: typeof onAuth) => { onAuth = cb; return { data: { subscription: { unsubscribe: () => {} } } } },
  } }),
}))
const { default: Analytics } = await import('@/app/Analytics')

beforeEach(() => { cleanup(); session = signedIn(); a.init.mockClear(); a.identify.mockClear(); a.forget.mockClear() })
afterEach(() => { vi.useRealTimers() })

describe('<Analytics />', () => {
  it('starts GA with the user id when the session reads in time', async () => {
    render(<Analytics />)
    await vi.waitFor(() => expect(a.init).toHaveBeenCalledWith('u1'))
  })

  it('a stalled session read still starts GA, and INITIAL_SESSION fills in the id', async () => {
    vi.useFakeTimers()
    session = new Promise(() => {})
    render(<Analytics />)
    await vi.advanceTimersByTimeAsync(1600)
    expect(a.init).toHaveBeenCalledWith(null)
    onAuth('INITIAL_SESSION', { user: { id: 'u2' } })
    expect(a.identify).toHaveBeenCalledWith('u2')
  })

  it('sign-out clears the id and the onboarding counters', () => {
    render(<Analytics />)
    onAuth('SIGNED_OUT', null)
    expect(a.identify).toHaveBeenCalledWith(null)
    expect(a.forget).toHaveBeenCalledOnce()
  })
})
