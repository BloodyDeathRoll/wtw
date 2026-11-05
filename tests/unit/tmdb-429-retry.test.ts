import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getWatchProviders } from '@/lib/tmdb'

const r429 = (retryAfter?: string) =>
  new Response('', { status: 429, headers: retryAfter ? { 'retry-after': retryAfter } : {} })
const ok = () => new Response(JSON.stringify({ results: {} }), { status: 200 })

describe('tmdbFetch 429 retry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubEnv('TMDB_API_KEY', 'test')
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('retries a 429 and returns the later success', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(r429()).mockResolvedValueOnce(r429('2')).mockResolvedValueOnce(ok())
    vi.stubGlobal('fetch', fetch)
    const p = getWatchProviders('movie', '1', ['US'])
    await vi.advanceTimersByTimeAsync(1000) // backoff after 1st 429
    await vi.advanceTimersByTimeAsync(2000) // Retry-After: 2
    await expect(p).resolves.toEqual({})
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('throws after 3 retries', async () => {
    const fetch = vi.fn().mockImplementation(async () => r429())
    vi.stubGlobal('fetch', fetch)
    const p = getWatchProviders('movie', '1', ['US'])
    const caught = expect(p).rejects.toThrow('TMDB 429')
    await vi.advanceTimersByTimeAsync(1000 + 2000 + 4000)
    await caught
    expect(fetch).toHaveBeenCalledTimes(4)
  })

  it('caps a long Retry-After at 4s', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(r429('60')).mockResolvedValueOnce(ok())
    vi.stubGlobal('fetch', fetch)
    const p = getWatchProviders('movie', '1', ['US'])
    await vi.advanceTimersByTimeAsync(4000)
    await expect(p).resolves.toEqual({})
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
