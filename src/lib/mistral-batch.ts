/**
 * Mistral for the BATCH path (nightly enrichment + lineage graphs).
 *
 * 2026-09-04: the nightly catalog job burned ~2,000 Mistral calls a night on
 * the same key the app uses live. The workspace hit 429 with a per-minute
 * limit of 0 and stayed there; the job kept hammering (15 of 15 attempts
 * failed, two nights, three retries each) while every user-facing Mistral
 * call — session-end rule extraction, rerank, fingerprint embedding — failed
 * silently on the same wall. Three things live here so the batch path can be
 * governed separately from the live one:
 *
 *   - its own key (`MISTRAL_BATCH_API_KEY`, falling back to `MISTRAL_API_KEY`)
 *   - a 429 detector plus a `retry-after` reader, so the loop can cool down
 *     on a transient limit and tell that apart from a spent workspace,
 *     instead of retrying its way through the rest of the budget
 *   - a call counter, so the run can be capped in calls (the unit Mistral
 *     meters) rather than in titles
 *
 * Model IDs stay in ./ai-models.ts — this file only picks the key.
 */

import { APICallError, RetryError } from 'ai'

/** Retries on a rate-limited key triple the burn for nothing. Batch = none. */
export const BATCH_MAX_RETRIES = 0

export function batchMistralApiKey(): string {
  const key = process.env.MISTRAL_BATCH_API_KEY || process.env.MISTRAL_API_KEY
  if (!key) throw new Error('MISTRAL_BATCH_API_KEY / MISTRAL_API_KEY is not set')
  return key
}

/**
 * True when the failure is Mistral saying "rate limit exceeded" (HTTP 429),
 * however the SDK wrapped it: a bare APICallError, a RetryError whose last
 * attempt was one, or a plain Error carrying the provider's message.
 */
export function isMistralRateLimit(err: unknown): boolean {
  if (APICallError.isInstance(err)) {
    return err.statusCode === 429 || /rate limit/i.test(err.message)
  }
  if (RetryError.isInstance(err)) {
    return err.errors.some(isMistralRateLimit) || isMistralRateLimit(err.lastError)
  }
  if (err instanceof Error) return /rate limit exceeded|\b429\b/i.test(err.message)
  return false
}

/**
 * Milliseconds Mistral asked the caller to wait, read from a 429's
 * `retry-after` header (a count of seconds, or an HTTP date), or null when it
 * did not say. Unwraps the same shapes `isMistralRateLimit` does.
 */
export function mistralRetryAfterMs(err: unknown): number | null {
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
      const ms = mistralRetryAfterMs(e)
      if (ms !== null) return ms
    }
    return mistralRetryAfterMs(err.lastError)
  }
  return null
}

let calls = 0

/** Count one Mistral request on the batch path. Call it BEFORE the request —
 *  a request that fails still spent the quota. */
export function recordMistralCall(): void {
  calls++
}
export function mistralCallCount(): number {
  return calls
}
export function resetMistralCallCount(): void {
  calls = 0
}
