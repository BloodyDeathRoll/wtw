import { describe, it, expect, vi, beforeEach } from 'vitest'

// #246 (2026-11-15): a brand-new account reaches the onboarding with dna = null.
// ensureFingerprint writes the blank fingerprint, only while dna is still null.

const db = vi.hoisted(() => ({ dna: null as unknown, calls: [] as string[], fail: false }))
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: () => {
      let patch: { dna: unknown } | null = null
      const q = {
        update: (p: { dna: unknown }) => { patch = p; db.calls.push('update'); return q },
        eq: () => q,
        is: (col: string, v: unknown) => { db.calls.push(`is ${col} ${v}`); return q },
        select: async () => {
          if (db.fail) return { data: null, error: { message: 'boom' } }
          if (db.dna === null && patch) { db.dna = patch.dna; return { data: [{ id: 'u1' }], error: null } }
          return { data: [], error: null }
        },
      }
      return q
    },
  }),
}))

const { ensureFingerprint } = await import('@/lib/ensure-fingerprint')

beforeEach(() => { db.dna = null; db.calls = []; db.fail = false; vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}) })

describe('ensureFingerprint', () => {
  it('writes a blank fingerprint for a new account, only where dna is null', async () => {
    expect(await ensureFingerprint('u1')).toBe('created')
    expect(db.calls).toContain('is dna null')
    expect((db.dna as { metadata: { user_id: string } }).metadata.user_id).toBe('u1')
  })
  it('leaves an existing fingerprint alone', async () => {
    db.dna = { existing: true }
    expect(await ensureFingerprint('u1')).toBe('existed')
    expect(db.dna).toEqual({ existing: true })
  })
  it('never throws: a failed write says so', async () => {
    db.fail = true
    expect(await ensureFingerprint('u1')).toBe('failed')
  })
})
