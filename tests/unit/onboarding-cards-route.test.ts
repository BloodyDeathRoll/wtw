// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import titles from '@/app/play/data/titles.json'

// #246 (2026-11-15): a brand-new account's card answers got 404 "Profile not
// found" — its users.dna was still null. The route now creates the blank
// fingerprint and saves the answers.

const io = vi.hoisted(() => ({ outcomes: [] as string[], ensured: 0, saves: 0 }))
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: () => {} }))
vi.mock('@/lib/auth-guard', () => ({ logAuthFailure: () => {} }))
vi.mock('@/lib/supabase/auth-user', () => ({ getAuthUser: async () => ({ id: 'u1' }) }))
const chain = () => {
  const q: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'insert']) q[m] = () => q
  q.then = (r: (v: unknown) => void) => r({ data: [], error: null })
  return q
}
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ from: chain }) }))
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ from: chain }) }))
vi.mock('@/modules/dna/merge-feedback-signal', () => ({ mergeFeedbackSignalsLight: async () => {} }))
vi.mock('@/modules/engine/first-feed', () => ({ kickFirstFeed: async () => {} }))
vi.mock('@/modules/dna/lib/load-save', () => ({
  bumpVersion: () => {},
  withDNAUpdate: async () => { io.saves++; return io.outcomes.shift() ?? 'saved' },
}))
vi.mock('@/lib/ensure-fingerprint', () => ({ ensureFingerprint: async () => { io.ensured++; return 'created' } }))

const { POST } = await import('@/app/api/onboarding/cards/route')
const id = (titles as { id: string }[])[0].id
const post = () => POST(new Request('http://x/api/onboarding/cards', { method: 'POST', body: JSON.stringify({ answers: [{ id, r: 'loved' }] }) }) as never)

beforeEach(() => { io.outcomes = []; io.ensured = 0; io.saves = 0 })

describe('POST /api/onboarding/cards', () => {
  it('a new account with no fingerprint: creates it, then saves the answers', async () => {
    io.outcomes = ['missing', 'saved']
    const res = await post()
    expect(res.status).toBe(200)
    expect(io.ensured).toBe(1)
    expect(io.saves).toBe(2)
  })
  it('an account with a fingerprint saves once and creates nothing', async () => {
    const res = await post()
    expect(res.status).toBe(200)
    expect(io.ensured).toBe(0)
    expect(io.saves).toBe(1)
  })
})
