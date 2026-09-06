import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { APICallError, RetryError } from 'ai'
import {
  batchMistralApiKey,
  isMistralRateLimit,
  recordMistralCall,
  mistralCallCount,
  resetMistralCallCount,
  BATCH_MAX_RETRIES,
} from '@/lib/mistral-batch'

// 2026-09-04: the nightly job spent the shared Mistral workspace to a
// 0 req/min wall and kept retrying into it for two nights. These guard the
// three things that stop that: the 429 detector, the call counter, no retries.

const rateLimit = () =>
  new APICallError({
    message: 'Rate limit exceeded',
    url: 'https://api.mistral.ai/v1/chat/completions',
    requestBodyValues: {},
    statusCode: 429,
  })

describe('isMistralRateLimit', () => {
  it('recognises a bare 429 APICallError', () => {
    expect(isMistralRateLimit(rateLimit())).toBe(true)
  })

  it('recognises a 429 wrapped by the SDK retry loop', () => {
    const wrapped = new RetryError({
      message: 'Failed after 3 attempts. Last error: Rate limit exceeded',
      reason: 'maxRetriesExceeded',
      errors: [rateLimit(), rateLimit(), rateLimit()],
    })
    expect(isMistralRateLimit(wrapped)).toBe(true)
  })

  it("recognises the provider's message on a plain Error", () => {
    expect(isMistralRateLimit(new Error('Rate limit exceeded'))).toBe(true)
  })

  it('does not fire on other API failures', () => {
    const serverError = new APICallError({
      message: 'Internal Server Error',
      url: 'https://api.mistral.ai/v1/chat/completions',
      requestBodyValues: {},
      statusCode: 500,
    })
    expect(isMistralRateLimit(serverError)).toBe(false)
    expect(isMistralRateLimit(new Error('Failed to update narrative for 1'))).toBe(false)
    expect(isMistralRateLimit('nope')).toBe(false)
    expect(isMistralRateLimit(undefined)).toBe(false)
  })
})

describe('batchMistralApiKey', () => {
  const saved = { batch: process.env.MISTRAL_BATCH_API_KEY, live: process.env.MISTRAL_API_KEY }
  afterEach(() => {
    process.env.MISTRAL_BATCH_API_KEY = saved.batch
    process.env.MISTRAL_API_KEY = saved.live
    if (saved.batch === undefined) delete process.env.MISTRAL_BATCH_API_KEY
    if (saved.live === undefined) delete process.env.MISTRAL_API_KEY
  })

  it('prefers the batch key', () => {
    process.env.MISTRAL_BATCH_API_KEY = 'batch-key'
    process.env.MISTRAL_API_KEY = 'live-key'
    expect(batchMistralApiKey()).toBe('batch-key')
  })

  it('falls back to the live key', () => {
    delete process.env.MISTRAL_BATCH_API_KEY
    process.env.MISTRAL_API_KEY = 'live-key'
    expect(batchMistralApiKey()).toBe('live-key')
  })

  it('throws when neither is set', () => {
    delete process.env.MISTRAL_BATCH_API_KEY
    delete process.env.MISTRAL_API_KEY
    expect(() => batchMistralApiKey()).toThrow(/not set/)
  })
})

describe('call counter', () => {
  beforeEach(() => resetMistralCallCount())

  it('counts every recorded call', () => {
    expect(mistralCallCount()).toBe(0)
    recordMistralCall()
    recordMistralCall()
    expect(mistralCallCount()).toBe(2)
  })

  it('batch calls never retry', () => {
    expect(BATCH_MAX_RETRIES).toBe(0)
  })
})
