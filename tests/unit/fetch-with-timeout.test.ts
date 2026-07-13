import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchWithTimeout } from '@/lib/fetch-with-timeout'

// The hang fix ("Reading your taste…" could stick forever): fetchWithTimeout
// must always settle — resolve normally, or reject when the request outlives
// the timeout — so the awaiting caller's `finally` always clears its loader.

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('fetchWithTimeout', () => {
  it('resolves with the response when fetch completes before the timeout', async () => {
    const res = new Response('ok')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res))
    await expect(fetchWithTimeout('/x', {}, 1000)).resolves.toBe(res)
  })

  it('passes a (non-aborted) AbortSignal through to fetch', async () => {
    const spy = vi.fn().mockResolvedValue(new Response('ok'))
    vi.stubGlobal('fetch', spy)
    await fetchWithTimeout('/x', {}, 1000)
    const init = spy.mock.calls[0][1] as RequestInit
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect((init.signal as AbortSignal).aborted).toBe(false)
  })

  it('aborts and rejects when the request hangs past the timeout', async () => {
    vi.useFakeTimers()
    // Never settles on its own — only rejects when its signal is aborted,
    // exactly like a real fetch on abort.
    vi.stubGlobal('fetch', (_input: RequestInfo | URL, init: RequestInit = {}) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(new DOMException('The operation was aborted.', 'AbortError')),
        )
      }),
    )
    const p = fetchWithTimeout('/x', {}, 1000)
    // Attach the rejection expectation before advancing so it never surfaces as
    // an unhandled rejection.
    const assertion = expect(p).rejects.toThrow(/abort/i)
    await vi.advanceTimersByTimeAsync(1000)
    await assertion
  })
})
