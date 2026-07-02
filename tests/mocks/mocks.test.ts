import { describe, it, expect } from 'vitest'
import { createFakeRedis, createFakeSupabase, makeAiMock } from './index'

// Smoke test for the shared mock layer itself, and a template for how
// integration tests wire these into `vi.mock(...)`.
describe('mock layer', () => {
  it('fake redis behaves like get/set/del with JSON values', async () => {
    const redis = createFakeRedis()
    expect(await redis.get('dna:u1')).toBeNull()
    await redis.set('dna:u1', { taste_version: 3 })
    expect(await redis.get('dna:u1')).toEqual({ taste_version: 3 })
    expect(await redis.del('dna:u1')).toBe(1)
    expect(await redis.get('dna:u1')).toBeNull()
  })

  it('fake supabase resolves canned data and records writes', async () => {
    const db = createFakeSupabase({
      users: { data: { dna: { metadata: { taste_version: 7 } } }, error: null },
    })

    const { data } = await db.from('users').select('dna').eq('id', 'u1').single()
    expect((data as { dna: { metadata: { taste_version: number } } }).dna.metadata.taste_version).toBe(7)

    await db.from('users').update({ dna: { updated: true } }).eq('id', 'u1')
    expect(db.writes).toEqual([{ table: 'users', op: 'update', payload: { dna: { updated: true } } }])
  })

  it('ai mock can force success or failure', async () => {
    const ok = makeAiMock({ object: { ranked: [] } })
    expect((await ok.generateObject()).object).toEqual({ ranked: [] })

    const bad = makeAiMock({ throws: new Error('429 rate limit') })
    await expect(bad.generateObject()).rejects.toThrow('429')
  })
})
