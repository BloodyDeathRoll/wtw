/**
 * LLM calls for the BATCH path (nightly enrichment + lineage graphs).
 *
 * 2026-09-04: the nightly catalog job burned ~2,000 Mistral calls a night on
 * the same key the app uses live. The workspace hit 429 with a per-minute
 * limit of 0 and stayed there; the job kept hammering (15 of 15 attempts
 * failed, two nights, three retries each) while every user-facing Mistral
 * call — session-end rule extraction, rerank, fingerprint embedding — failed
 * silently on the same wall. Three things live here so the batch path can be
 * governed separately from the live one:
 *
 *   - its own key (`GEMINI_BATCH_API_KEY`, falling back to `GEMINI_API_KEY`)
 *   - a 429 detector plus a `retry-after` reader, so the loop can cool down
 *     on a transient limit and tell that apart from a spent workspace,
 *     instead of retrying its way through the rest of the budget
 *   - a call counter, so the run can be capped in calls (the unit the
 *     provider meters) rather than in titles
 *
 * Model IDs stay in ./ai-models.ts — this file only picks the key.
 *
 * 2026-11-26: the batch path is on Gemini now (src/lib/gemini.ts — Mistral's
 * Free mode dropped API access). The 429 / retry-after / counter helpers are
 * provider-neutral (renamed from mistral-batch.ts); the key is GEMINI_BATCH_API_KEY,
 * falling back to GEMINI_API_KEY.
 */
import 'server-only'

import { APICallError, RetryError } from 'ai'

/** Retries on a rate-limited key triple the burn for nothing. Batch = none. */
export const BATCH_MAX_RETRIES = 0

export function batchApiKey(): string {
  const key = process.env.GEMINI_BATCH_API_KEY || process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_BATCH_API_KEY / GEMINI_API_KEY is not set')
  return key
}

/**
 * True when the failure is the provider saying "rate limit exceeded" (HTTP 429),
 * however the SDK wrapped it: a bare APICallError, a RetryError whose last
 * attempt was one, or a plain Error carrying the provider's message.
 */
export function isBatchRateLimit(err: unknown): boolean {
  if (APICallError.isInstance(err)) {
    return err.statusCode === 429 || /rate limit/i.test(err.message)
  }
  if (RetryError.isInstance(err)) {
    return err.errors.some(isBatchRateLimit) || isBatchRateLimit(err.lastError)
  }
  if (err instanceof Error) return /rate limit exceeded|\b429\b/i.test(err.message)
  return false
}

/**
 * Milliseconds the provider asked the caller to wait, read from a 429's
 * `retry-after` header (a count of seconds, or an HTTP date), or null when it
 * did not say. Unwraps the same shapes `isBatchRateLimit` does.
 */
export function batchRetryAfterMs(err: unknown): number | null {
  if (APICallError.isInstance(err)) {
    const headers = err.responseHeaders ?? {}
    // Header names are case-insensitive and the SDK does not normalise them.
    const key = Object.keys(headers).find(k => k.toLowerCase() === 'retry-after')
    const raw = key === undefined ? undefined : headers[key]
    if (raw === undefined) return null
    const value = raw.trim()
    // `Number('')` is 0 and `Number.isFinite(0)` is true, so an empty-but-
    // present header would read as "retry immediately" rather than "did not
    // say" — and the caller would skip its own default wait.
    if (value === '') return null
    const seconds = Number(value)
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
    const at = Date.parse(value)
    return Number.isNaN(at) ? null : Math.max(0, at - Date.now())
  }
  if (RetryError.isInstance(err)) {
    for (const e of err.errors) {
      const ms = batchRetryAfterMs(e)
      if (ms !== null) return ms
    }
    return batchRetryAfterMs(err.lastError)
  }
  return null
}

let calls = 0

/** Count one LLM request on the batch path. Call it BEFORE the request —
 *  a request that fails still spent the quota. */
export function recordBatchCall(): void {
  calls++
}
export function batchCallCount(): number {
  return calls
}
export function resetBatchCallCount(): void {
  calls = 0
}
