// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// v3 Y3: delete the user's Redis keys, then the login (every table cascades from it).

const io = vi.hoisted(() => ({ sweeps: [] as string[][], keys: [] as string[], deleted: [] as string[], removedUser: '' as string, fail: false, sub: 'u1' as string | null, redisDown: false }))
vi.mock('@/lib/reset-taste', () => ({ userRedisKeys: async () => { if (io.redisDown) throw new Error('redis down'); if (io.sweeps.length) return io.sweeps.shift()!; const k = io.keys; io.keys = []; return k } }))
vi.mock('@/lib/redis', () => ({ getRedis: () => ({ del: async (...k: string[]) => { io.deleted.push(...k) } }) }))
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ auth: { admin: { deleteUser: async (id: string) => {
  if (io.fail) return { error: { message: 'boom' } }
  io.removedUser = id; return { error: null }
} } } }) }))
vi.mock('@/lib/flags', async (o) => ({ ...(await o<typeof import('@/lib/flags')>()), navTabsEnabled: () => true }))
vi.mock('@/lib/auth-guard', () => ({ logAuthFailure: () => {} }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }))
vi.mock('@/lib/supabase/auth-user', () => ({ getAuthUser: async () => (io.sub ? { id: io.sub } : null) }))

const { deleteAccount } = await import('@/lib/delete-account')
const { POST } = await import('@/app/api/account/delete/route')
const post = (body: unknown) => POST(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }) as never)

beforeEach(() => {
  Object.assign(io, { sweeps: [], keys: [], deleted: [], removedUser: '', fail: false, sub: 'u1', redisDown: false })
  vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('deleteAccount', () => {
  it('deletes the user\'s Redis keys, then the login', async () => {
    io.keys = ['rec:u1:3:all', 'v2_pool:u1:all']
    expect(await deleteAccount('u1')).toEqual({ redisKeys: 2 })
    expect(io.deleted).toEqual(['rec:u1:3:all', 'v2_pool:u1:all'])
    expect(io.removedUser).toBe('u1')
  })
  it('Redis down: nothing is deleted, and it throws so the person can try again', async () => {
    io.redisDown = true
    await expect(deleteAccount('u1')).rejects.toThrow(/clear redis/)
    expect(io.removedUser).toBe('')
  })
  it('a key written between the sweep and the login delete is swept afterwards', async () => {
    io.sweeps = [['rec:u1:3:all'], ['rl:feedback:u:u1']]          // the second appeared after the first sweep
    expect(await deleteAccount('u1')).toEqual({ redisKeys: 2 })
    expect(io.deleted).toEqual(['rec:u1:3:all', 'rl:feedback:u:u1'])
  })
  it('a failed login delete throws, so the sheet says so and can try again', async () => {
    io.fail = true
    await expect(deleteAccount('u1')).rejects.toThrow(/delete login/)
  })
})

describe('POST /api/account/delete', () => {
  it('needs the confirmation', async () => {
    expect((await post({ confirm: 'yes' })).status).toBe(400)
    expect(io.removedUser).toBe('')
  })
  it('signed out: 401', async () => {
    io.sub = null
    expect((await post({ confirm: 'delete-account' })).status).toBe(401)
  })
  it('confirmed: deleted, ok', async () => {
    expect(await (await post({ confirm: 'delete-account' })).json()).toEqual({ ok: true })
    expect(io.removedUser).toBe('u1')
  })
  it('a failure: 500', async () => {
    io.fail = true
    expect((await post({ confirm: 'delete-account' })).status).toBe(500)
  })
})
