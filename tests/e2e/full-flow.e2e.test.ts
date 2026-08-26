/**
 * WTW — end-to-end integration harness (INTEGRATION.md §3).
 *
 * This is the "full flow with real keys" check that has never been run:
 *   bootstrap DNA → session summary → DNA update → generate recs
 *   → verify the Redis cache hits by taste_version
 * plus §3's second item, writeDNA against a live Supabase.
 *
 * ── It does NOT run by default ───────────────────────────────────────────────
 * vitest.config.ts globs `tests/*​*​/*.test.ts`, so this file IS collected by
 * `npm test` — but every suite below is `describe.skipIf(!LIVE)`, and LIVE is
 * false unless you opt in explicitly:
 *
 *   WTW_E2E=1 npm test -- tests/e2e
 *
 * Without WTW_E2E the file reports as skipped, which is why it is safe to leave
 * in the default run: CI stays green and nobody spends TMDB/OMDB/Mistral quota
 * by accident.
 *
 * ── What it costs when you DO run it ─────────────────────────────────────────
 * Real rows in real tables, and real third-party quota:
 *   • Supabase  — writes user_dna, dna_snapshots, fingerprint_embeddings for
 *                 WTW_E2E_USER_ID. Cleanup is best-effort in afterAll.
 *   • Mistral   — one embedding per taste_version (regenerateEmbedding).
 *   • Groq      — the session analysis / notes rewrite in the update pipeline.
 *   • TMDB/OMDB — only if the engine has to enrich a candidate it does not hold.
 * Point WTW_E2E_USER_ID at a scratch user, never a real account.
 *
 * ── Required env ─────────────────────────────────────────────────────────────
 *   WTW_E2E=1
 *   WTW_E2E_USER_ID=<uuid of a throwaway auth user that exists in Supabase>
 *   + the normal .env.local set (Supabase service role, Upstash, Groq, Mistral)
 * Run it as: `WTW_E2E=1 node --env-file=.env.local ...` or export them first —
 * vitest does not read .env.local on its own.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { loadDNA, saveDNA, createBlankDNA, updateSchemaFromSession } from '@/modules/dna'
import { generateRecommendations } from '@/modules/engine'
import { recCacheKey, getCachedRecommendations } from '@/modules/engine/pipeline/step8-cache'
import { createServiceClient } from '@/lib/supabase/service'
import { getRedis } from '@/lib/redis'
import type { SessionSummary } from '@/types/dna'

const USER_ID = process.env.WTW_E2E_USER_ID ?? ''

// Every one of these is load-bearing; a partial set would fail deep inside the
// pipeline with an unhelpful error, so gate on all of them up front.
const REQUIRED = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'GROQ_API_KEY',
  'MISTRAL_API_KEY',
]
const missing = REQUIRED.filter((k) => !process.env[k])
const LIVE = process.env.WTW_E2E === '1' && USER_ID !== '' && missing.length === 0

if (process.env.WTW_E2E === '1' && !LIVE) {
  // Opted in but under-configured — say which knob is wrong instead of
  // silently skipping, which would read as "the flow passed".
  console.warn(
    `[e2e] WTW_E2E=1 but not runnable — ${
      !USER_ID ? 'WTW_E2E_USER_ID is unset' : `missing env: ${missing.join(', ')}`
    }`,
  )
}

describe.skipIf(!LIVE)('E2E · DNA write path against live Supabase', () => {
  afterAll(async () => {
    // Best-effort teardown. Leaving rows behind is not fatal — the next run
    // overwrites them — so a failure here must not fail the suite.
    try {
      const db = createServiceClient()
      await db.from('dna_snapshots').delete().eq('user_id', USER_ID)
      await db.from('fingerprint_embeddings').delete().eq('user_id', USER_ID)
      await db.from('user_dna').delete().eq('user_id', USER_ID)
      await getRedis()?.del(recCacheKey(USER_ID, 1))
    } catch (err) {
      console.warn('[e2e] cleanup failed (non-fatal):', err)
    }
  })

  it('saveDNA → loadDNA round-trips a blank fingerprint', async () => {
    const blank = createBlankDNA(USER_ID)
    await saveDNA(USER_ID, blank)

    const read = await loadDNA(USER_ID)
    expect(read).not.toBeNull()
    expect(read!.metadata.user_id).toBe(USER_ID)
    // The contract every module depends on: a fresh fingerprint starts at a
    // known taste_version so the cache key below is predictable.
    expect(read!.metadata.taste_version).toBe(blank.metadata.taste_version)
  })

  it('updateSchemaFromSession merges signals and bumps taste_version', async () => {
    const before = await loadDNA(USER_ID)
    expect(before).not.toBeNull()

    // The real contract (src/types/dna.ts:205) — every field, no casts. If this
    // stops compiling, Assignment 1's producer and Assignment 3's consumer have
    // drifted, which is exactly the seam §3 exists to catch.
    const summary: SessionSummary = {
      session_number: 1,
      new_signals: [
        {
          title: 'E2E Harness Fixture',
          tmdb_id: '550', // Fight Club — stable, always present on TMDB
          type: 'movie',
          reaction: 'loved',
          quick_rating: 5,
          regret_signal: null,
          source: 'session_1',
          reason: 'e2e harness — synthetic signal',
          dimensions_reinforced: ['moral_ambiguity'],
          dimensions_contradicted: [],
          confidence: 0.7,
          flag: null,
          watched_at: null,
        },
      ],
      dimension_updates: {},
      // Append-only during a session (CLAUDE.md) — the harness resolves nothing.
      open_questions_resolved: [],
      new_open_questions: [],
      recommendation_made: null,
      recommendation_accepted: null,
    }

    await updateSchemaFromSession(USER_ID, summary)

    const after = await loadDNA(USER_ID)
    expect(after).not.toBeNull()
    // CLAUDE.md standing rule: every DNA write increments taste_version and
    // stamps last_updated. This is the assertion that proves it end to end
    // rather than in a mock.
    expect(after!.metadata.taste_version).toBeGreaterThan(
      before!.metadata.taste_version,
    )
    expect(new Date(after!.metadata.last_updated).getTime()).toBeGreaterThanOrEqual(
      new Date(before!.metadata.last_updated).getTime(),
    )
  }, 120_000) // Groq notes rewrite + Mistral embed + snapshot — not a 5s job
})

describe.skipIf(!LIVE)('E2E · recommendations + Redis cache by taste_version', () => {
  let tasteVersion = 0

  beforeAll(async () => {
    const dna = await loadDNA(USER_ID)
    if (!dna) throw new Error('[e2e] run the DNA suite first — no fingerprint')
    tasteVersion = dna.metadata.taste_version
    // Start from a cold cache or the "second call is cached" assertion below
    // proves nothing.
    await getRedis()?.del(recCacheKey(USER_ID, tasteVersion))
  })

  it('generates recs and writes them to the cache under the current taste_version', async () => {
    const recs = await generateRecommendations(USER_ID)
    expect(Array.isArray(recs)).toBe(true)
    expect(recs.length).toBeGreaterThan(0)

    const cached = await getCachedRecommendations(USER_ID, tasteVersion)
    expect(cached).not.toBeNull()
    expect(cached!.length).toBe(recs.length)
  }, 120_000) // real LLM + TMDB calls; the default 5s timeout is far too short

  it('a second call is served from cache, not regenerated', async () => {
    const t0 = Date.now()
    const again = await generateRecommendations(USER_ID)
    const elapsed = Date.now() - t0

    expect(again.length).toBeGreaterThan(0)
    // A cache hit is a single Redis GET. Anything near the cold path (tens of
    // seconds) means the key did not match — usually a taste_version bumped
    // mid-flight by a stray DNA write.
    expect(elapsed).toBeLessThan(5_000)
  }, 120_000)

  it('bumping taste_version misses the old key', async () => {
    const dna = await loadDNA(USER_ID)
    expect(dna).not.toBeNull()
    // Never overwrite the whole schema (CLAUDE.md) — patch metadata only.
    const bumped = {
      ...dna!,
      metadata: {
        ...dna!.metadata,
        taste_version: dna!.metadata.taste_version + 1,
        last_updated: new Date().toISOString(),
      },
    }
    await saveDNA(USER_ID, bumped)

    // This is the whole point of versioning the key: stale recs must not
    // survive a fingerprint change.
    const stale = await getCachedRecommendations(
      USER_ID,
      bumped.metadata.taste_version,
    )
    expect(stale).toBeNull()
  })
})
