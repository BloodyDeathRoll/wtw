// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// The screens that offer the chat ask whether it would still answer today, without using a turn (WATCHLIST.md DEC-9).

const redis = vi.hoisted(() => ({ n: {} as Record<string, number | string>, down: false, incr: 0 }))
vi.mock('@/lib/redis', () => ({
  getRedis: () => ({
    get: async (key: string) => {
      if (redis.down) throw new Error('redis down')
      return redis.n[key] ?? null
    },
    incr: async () => ++redis.incr,
  }),
}))

import { chatHasTurns } from '@/lib/chat-budget'

const MINE = 'rl:chat-day:u:u1'
const ALL = 'rl:chat-day-all:u:all'

beforeEach(() => {
  redis.n = {}
  redis.down = false
  redis.incr = 0
})

describe('chatHasTurns', () => {
  it('is true with nothing used, and uses no turn', async () => {
    expect(await chatHasTurns('u1')).toBe(true)
    expect(redis.incr).toBe(0)
  })

  it('is true on the last turn, false once the person has used all 10', async () => {
    redis.n[MINE] = 9
    expect(await chatHasTurns('u1')).toBe(true)
    redis.n[MINE] = '10'
    expect(await chatHasTurns('u1')).toBe(false)
  })

  it('is false once everyone together has used all 20', async () => {
    redis.n[ALL] = 20
    expect(await chatHasTurns('u1')).toBe(false)
  })

  it('is false when Redis cannot answer: the chat would refuse too', async () => {
    redis.down = true
    expect(await chatHasTurns('u1')).toBe(false)
  })
})
