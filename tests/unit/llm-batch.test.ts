import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { APICallError, RetryError } from 'ai'
import {
  batchApiKey,
  isBatchRateLimit,
  recordBatchCall,
  batchCallCount,
  resetBatchCallCount,
  BATCH_MAX_RETRIES,
} from '@/lib/llm-batch'

// 2026-09-04: the nightly job spent the shared Mistral workspace to a
// 0 req/min wall and kept retrying into it for two nights. These guard the
// three things that stop that: the 429 detector, the call counter, no retries.

const rateLimit = () =>
  new APICallError({
    message: 'Rate limit exceeded',
    url: 'https://generativelanguage.googleapis.com/v1beta/models',
    requestBodyValues: {},
    statusCode: 429,
  })

describe('isBatchRateLimit', () => {
  it('recognises a bare 429 APICallError', () => {
    expect(isBatchRateLimit(rateLimit())).toBe(true)
  })

  it('recognises a 429 wrapped by the SDK retry loop', () => {
    const wrapped = new RetryError({
      message: 'Failed after 3 attempts. Last error: Rate limit exceeded',
      reason: 'maxRetriesExceeded',
      errors: [rateLimit(), rateLimit(), rateLimit()],
    })
    expect(isBatchRateLimit(wrapped)).toBe(true)
  })

  it("recognises the provider's message on a plain Error", () => {
    expect(isBatchRateLimit(new Error('Rate limit exceeded'))).toBe(true)
  })

  it('does not fire on other API failures', () => {
    const serverError = new APICallError({
      message: 'Internal Server Error',
      url: 'https://generativelanguage.googleapis.com/v1beta/models',
      requestBodyValues: {},
      statusCode: 500,
    })
    expect(isBatchRateLimit(serverError)).toBe(false)
    expect(isBatchRateLimit(new Error('Failed to update narrative for 1'))).toBe(false)
    expect(isBatchRateLimit('nope')).toBe(false)
    expect(isBatchRateLimit(undefined)).toBe(false)
  })
})

describe('batchApiKey', () => {
  const saved = { batch: process.env.GEMINI_BATCH_API_KEY, live: process.env.GEMINI_API_KEY }
  afterEach(() => {
    process.env.GEMINI_BATCH_API_KEY = saved.batch
    process.env.GEMINI_API_KEY = saved.live
    if (saved.batch === undefined) delete process.env.GEMINI_BATCH_API_KEY
    if (saved.live === undefined) delete process.env.GEMINI_API_KEY
  })

  it('prefers the batch key', () => {
    process.env.GEMINI_BATCH_API_KEY = 'batch-key'
    process.env.GEMINI_API_KEY = 'live-key'
    expect(batchApiKey()).toBe('batch-key')
  })

  it('falls back to the live key', () => {
    delete process.env.GEMINI_BATCH_API_KEY
    process.env.GEMINI_API_KEY = 'live-key'
    expect(batchApiKey()).toBe('live-key')
  })

  it('throws when neither is set', () => {
    delete process.env.GEMINI_BATCH_API_KEY
    delete process.env.GEMINI_API_KEY
    expect(() => batchApiKey()).toThrow(/not set/)
  })
})

describe('call counter', () => {
  beforeEach(() => resetBatchCallCount())

  it('counts every recorded call', () => {
    expect(batchCallCount()).toBe(0)
    recordBatchCall()
    recordBatchCall()
    expect(batchCallCount()).toBe(2)
  })

  it('batch calls never retry', () => {
    expect(BATCH_MAX_RETRIES).toBe(0)
  })
})
