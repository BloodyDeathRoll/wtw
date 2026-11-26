import { describe, it, expect, vi, beforeEach } from 'vitest'

// #457: /api/dna/bootstrap reads through readUserDNA. A failed read is a 500 and never a blank DNA written.

const io = vi.hoisted(() => ({ read: null as null | (() => Promise<{ row: boolean; dna: unknown }>), writes: 0 }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }))
vi.mock('@/lib/supabase/auth-user', () => ({ getAuthUser: async () => ({ id: 'u1' }) }))
vi.mock('@/lib/auth-guard', () => ({ logAuthFailure: () => {} }))
vi.mock('@/modules/engine/dna-read', () => ({ readUserDNA: () => io.read!() }))
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({ from: () => ({ update: () => ({ eq: async () => { io.writes++; return { error: null } } }) }) }),
}))

const { POST } = await import('@/app/api/dna/bootstrap/route')
const call = async () => { const r = await POST(new Request('http://t', { method: 'POST' }) as never); return { status: r.status, body: await r.json() } }

describe('/api/dna/bootstrap (#457)', () => {
  beforeEach(() => { io.writes = 0 })

  it('a DNA already there: its version, nothing written', async () => {
    io.read = async () => ({ row: true, dna: { metadata: { taste_version: 12 } } })
    expect(await call()).toEqual({ status: 200, body: { ok: true, created: false, taste_version: 12 } })
    expect(io.writes).toBe(0)
  })

  it('no DNA yet: writes the blank one', async () => {
    io.read = async () => ({ row: true, dna: null })
    expect(await call()).toEqual({ status: 200, body: { ok: true, created: true, taste_version: 1 } })
    expect(io.writes).toBe(1)
  })

  it('a failed read: 500, and no blank DNA over the real one', async () => {
    io.read = async () => { throw new Error('connection lost') }
    expect((await call()).status).toBe(500)
    expect(io.writes).toBe(0)
  })
})
