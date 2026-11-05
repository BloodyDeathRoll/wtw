import { describe, it, expect, vi, beforeEach } from 'vitest'

// welcomeForSignals: no greeting below the maturity bar; above it, one Groq
// call per user per quarter of the local day, the rest served from Redis;
// Redis trouble never blocks the greeting.

const generateText = vi.fn(async () => ({ text: 'Evening, Ada — something slow and dark?' }))
vi.mock('ai', () => ({ generateText }))
vi.mock('@ai-sdk/groq', () => ({ groq: () => 'groq-model' }))
const redis = { get: vi.fn(async () => null as string | null), set: vi.fn(async () => 'OK') }
vi.mock('@/lib/redis', () => ({ getRedis: () => redis }))

const { welcomeForSignals } = await import('@/lib/welcome')

beforeEach(() => vi.clearAllMocks())

describe('welcomeForSignals', () => {
  it('below the bar: null, no Groq, no Redis', async () => {
    expect(await welcomeForSignals('u1', 3, 'Ada', -180)).toEqual({ greeting: null })
    expect(generateText).not.toHaveBeenCalled()
    expect(redis.get).not.toHaveBeenCalled()
  })

  it('first load generates and caches for 4 hours under a per-user, per-quarter-day key', async () => {
    const out = await welcomeForSignals('u1', 12, 'Ada Lovelace', -180)
    expect(out.greeting).toContain('Ada')
    expect(generateText).toHaveBeenCalledTimes(1)
    const [key, value, opts] = redis.set.mock.calls[0] as unknown as [string, string, { ex: number }]
    expect(key).toMatch(/^greeting:u1:[0-3]$/)
    expect(value).toBe(out.greeting)
    expect(opts).toEqual({ ex: 4 * 60 * 60 })
  })

  it('a cached greeting is served without Groq', async () => {
    redis.get.mockResolvedValueOnce('cached hello')
    expect(await welcomeForSignals('u1', 12, 'Ada', null)).toEqual({ greeting: 'cached hello' })
    expect(generateText).not.toHaveBeenCalled()
    expect(redis.get).toHaveBeenCalledWith('greeting:u1:any')
  })

  it('Groq failed: the canned line is served and NOT cached', async () => {
    generateText.mockRejectedValueOnce(new Error('rate limited'))
    const out = await welcomeForSignals('u1', 12, 'Ada Lovelace', -180)
    expect(out.greeting).toBe('Hi Ada, what are you in the mood for tonight?')
    expect(redis.set).not.toHaveBeenCalled()
  })

  it('Redis down: the greeting is still generated', async () => {
    redis.get.mockRejectedValueOnce(new Error('redis down'))
    redis.set.mockRejectedValueOnce(new Error('redis down'))
    const out = await welcomeForSignals('u1', 12, 'Ada', -180)
    expect(out.greeting).toContain('Ada')
    expect(generateText).toHaveBeenCalledTimes(1)
  })
})
