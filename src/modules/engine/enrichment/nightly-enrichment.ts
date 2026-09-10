/**
 * runNightlyEnrichment
 *
 * Processes the enrichment backlog: titles in `titles` where enriched_at IS NULL.
 * Called by POST /api/cron/enrich (protected by CRON_SECRET).
 *
 * Runs strictly serially with a delay between calls to stay inside the
 * enrichment LLM's free-tier rate limits — see MODELS.enrichment in
 * src/lib/ai-models.ts for the current provider and its measured limits. A 429
 * that slips through anyway is cooled down and retried, not fatal; see the
 * RATE_LIMIT_* constants for how a transient limit is told from a spent key.
 *
 * Also runs buildLineageGraph for any crew members without lineage data,
 * capped at CREW_BATCH_SIZE per run to keep the job short.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { enrichTitleWithNarrative } from './enrich-title-narrative'
import { buildLineageGraph } from './build-lineage-graph'
import { isMistralRateLimit, mistralCallCount, mistralRetryAfterMs } from '@/lib/mistral-batch'

const TITLE_BATCH_SIZE = 1    // STRICTLY serial — one enrichment call at a time
const TITLE_LIMIT = 15        // titles enriched per run
const CREW_BATCH_SIZE = 8     // crew lineage rows per run
// Pacing derived from a measured probe (2026-07-09): Mistral free tier is
// 50 req/min + 50K tokens/min, resets per-minute, no daily/monthly header cap;
// a 45-call burst hit 0 failures. Each title = generateObject + embed (2 calls),
// each crew = 1 generateObject, and a real enrichment is only ~1K tokens — so
// the binding limit is ~50 req/min → ~25 titles/min. The 1.5s delay is applied
// BETWEEN items (title→title, crew→crew) — the generateObject+embed pair within
// a single title fires back-to-back — so traffic is bursty pairs, not a smooth
// stream. Either way a full run is 15*2 + 8*1 = 38 calls, under 50 req/min on
// count alone, and the burst probe hit 0 failures on 45 rapid calls. ~15
// titles/min, run ~120s (under the cron's 300s cap), 3x the old pace.
const BATCH_DELAY_MS = 1500

export interface EnrichmentReport {
  titles_processed: number
  titles_failed: number
  crew_processed: number
  crew_failed: number
  duration_ms: number
  /** Mistral requests this run made (extraction + embedding + lineage). */
  mistral_calls: number
  /**
   * Mistral answered 429 RATE_LIMIT_MAX_COOLDOWNS times in a row, each through
   * a cooldown: the key is spent, and the run stopped at that point. A 429 the
   * cooldown cleared leaves this false — the run recovered.
   */
  rate_limited: boolean
  /** The caller's call budget ran out before the backlog did. */
  budget_exhausted: boolean
  /**
   * The pending-crew select failed after its retries. Phase 1 (titles) had
   * already run and its counts above are real; lineage was skipped this run.
   * (A failed pending-titles select throws instead — nothing was spent.)
   */
  crew_queue_failed: boolean
}

export interface EnrichmentOptions {
  /**
   * Stop before the next item once this many Mistral calls have been made in
   * this run. A title costs 2 (extraction + embedding), a crew row 1. The
   * caller (grow-catalog) turns its nightly budget into this per-call cap.
   */
  maxMistralCalls?: number
  /**
   * Base wait after a 429 before the item is retried, overridden by the
   * response's `retry-after` when it carries one. Exists so tests can drive
   * the cooldown path without sleeping a real minute; production leaves it.
   */
  rateLimitCooldownMs?: number
}

// A 429 is not, on its own, proof that the key is spent. Both shapes are real:
//   2026-09-04 — the workspace sat at a per-minute limit of 0 and every one of
//     15 attempts failed, two nights running. Retrying there is pure burn on a
//     key the live app also needs.
//   2026-09-10 — 236 calls landed, then ONE 429 ended the phase with 96 of 300
//     enriched, 1,417 titles pending and ~2h of the 180m cap unspent.
// What tells them apart is what happens AFTER a cooldown: a per-minute window
// clears, a spent workspace does not. So cool down and retry the SAME item,
// and call it a wall only after RATE_LIMIT_MAX_COOLDOWNS consecutive 429s with
// no success in between. That is 3 wasted calls in the 09-04 shape (against 15
// before) and a full night's backlog recovered in the 09-10 one.
const TITLE_COST = 2
const CREW_COST = 1
const RATE_LIMIT_COOLDOWN_MS = 60_000       // one Mistral per-minute window
const RATE_LIMIT_MAX_COOLDOWNS = 3          // consecutive 429s ⇒ the key is spent
const RATE_LIMIT_MAX_COOLDOWN_MS = 300_000  // cap on a hostile `retry-after`

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// The pending-queue selects used to discard their `error`: a transient
// Supabase failure (the `fetch failed` seen during seeding) came back as
// data:null → an empty queue → the caller read "backlog empty" and exited
// with budget and time unspent (2026-09-08: 73 of 300 enriched, no 429, no
// failures). Retry a failed select, log each attempt, and throw if it never
// succeeds — an empty queue must mean an empty backlog.
const QUEUE_SELECT_ATTEMPTS = 3
const QUEUE_SELECT_RETRY_MS = 2000

async function selectQueue<T>(
  label: string,
  query: () => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  let lastMessage = ''
  for (let attempt = 1; attempt <= QUEUE_SELECT_ATTEMPTS; attempt++) {
    const { data, error } = await query()
    if (!error) return data ?? []
    lastMessage = error.message
    console.error(`[enrich] ${label} queue select failed (attempt ${attempt}/${QUEUE_SELECT_ATTEMPTS}): ${lastMessage}`)
    if (attempt < QUEUE_SELECT_ATTEMPTS) await new Promise(r => setTimeout(r, QUEUE_SELECT_RETRY_MS))
  }
  throw new Error(`[enrich] ${label} queue select failed ${QUEUE_SELECT_ATTEMPTS} times: ${lastMessage}`)
}

export async function runNightlyEnrichment(
  options: EnrichmentOptions = {},
): Promise<EnrichmentReport> {
  const start = Date.now()
  const callsAtStart = mistralCallCount()
  const maxCalls = options.maxMistralCalls ?? Infinity
  const callsLeft = () => maxCalls - (mistralCallCount() - callsAtStart)
  const supabase = createServiceClient()

  let titles_processed = 0
  let titles_failed = 0
  let crew_processed = 0
  let crew_failed = 0
  let rate_limited = false
  let budget_exhausted = false
  let crew_queue_failed = false
  const cooldownBase = options.rateLimitCooldownMs ?? RATE_LIMIT_COOLDOWN_MS
  let consecutiveRateLimits = 0

  /**
   * Run one item, absorbing a transient 429 by cooling down and retrying the
   * SAME item. The budget is re-checked before every attempt — a retry is a
   * real request and is metered like one.
   *
   *   'ok'     — the item ran: a success, a skip, or an ordinary failure
   *   'wall'   — RATE_LIMIT_MAX_COOLDOWNS consecutive 429s; the key is spent
   *   'budget' — no room left for another attempt
   */
  async function attempt(
    label: string,
    what: string,
    cost: number,
    run: () => Promise<void>,
    onFailure: (err: unknown) => void,
  ): Promise<'ok' | 'wall' | 'budget'> {
    for (;;) {
      if (callsLeft() < cost) return 'budget'
      try {
        await run()
        consecutiveRateLimits = 0
        return 'ok'
      } catch (err) {
        if (!isMistralRateLimit(err)) {
          // An ordinary failure is not evidence about the rate limit either
          // way: it neither proves the wall nor clears a run of 429s.
          onFailure(err)
          console.error(`[${label}] Failed ${what}:`, err)
          return 'ok'
        }
        consecutiveRateLimits++
        if (consecutiveRateLimits >= RATE_LIMIT_MAX_COOLDOWNS) {
          onFailure(err)
          console.error(
            `[${label}] Mistral rate limit (429) on ${what} — ${consecutiveRateLimits} in a row through a cooldown, the key is spent; stopping this run`,
          )
          return 'wall'
        }
        const asked = mistralRetryAfterMs(err)
        const wait = Math.min(asked ?? cooldownBase, RATE_LIMIT_MAX_COOLDOWN_MS)
        console.warn(
          `[${label}] Mistral rate limit (429) on ${what} — cooling down ${Math.round(wait / 1000)}s (${consecutiveRateLimits}/${RATE_LIMIT_MAX_COOLDOWNS}), then retrying`,
        )
        await sleep(wait)
      }
    }
  }

  // ── Phase 1: Enrich pending titles ───────────────────────
  const titleQueue = await selectQueue('titles', () => supabase
    .from('titles')
    .select('tmdb_id, title, type')
    .is('enriched_at', null)
    .order('created_at', { ascending: true })
    .limit(TITLE_LIMIT))

  for (let i = 0; i < titleQueue.length; i += TITLE_BATCH_SIZE) {
    if (callsLeft() < TITLE_COST) { budget_exhausted = true; break }
    const batch = titleQueue.slice(i, i + TITLE_BATCH_SIZE)

    await Promise.allSettled(
      batch.map(async ({ tmdb_id, title, type }) => {
        const outcome = await attempt(
          'enrich',
          `${tmdb_id} (${title})`,
          TITLE_COST,
          async () => {
            const ok = await enrichTitleWithNarrative(tmdb_id, type as 'movie' | 'tv')
            if (ok) {
              titles_processed++
            } else {
              console.warn(`[enrich] Skipped ${tmdb_id} (${title}) — not found in DB`)
            }
          },
          () => { titles_failed++ },
        )
        if (outcome === 'wall') rate_limited = true
        if (outcome === 'budget') budget_exhausted = true
      })
    )
    if (rate_limited || budget_exhausted) break

    // Delay between batches — skip delay after last batch
    if (i + TITLE_BATCH_SIZE < titleQueue.length) {
      await sleep(BATCH_DELAY_MS)
    }
  }

  // ── Phase 2: Build lineage for pending crew members ──────
  // Each buildLineageGraph call costs 1 Mistral request. Cap at
  // CREW_BATCH_SIZE per run, same serial concurrency + delay as titles.
  // A rate-limited or over-budget run skips lineage too: same key, same wall.
  // A failed crew select does not throw: Phase 1 already spent real calls and
  // wrote rows, and the caller needs those counts for its budget.
  let crewQueue: { tmdb_person_id: string; name: string; primary_role: string }[] = []
  if (!rate_limited && !budget_exhausted) {
    try {
      crewQueue = await selectQueue('crew', () => supabase
        .from('crew_members')
        .select('tmdb_person_id, name, primary_role')
        .is('enriched_at', null)
        .in('primary_role', ['director', 'writer', 'cinematographer'])
        // Only build lineage for the roles that matter for scoring.
        // Actors are excluded — lineage boost only applies to crew.
        .order('created_at', { ascending: true })
        .limit(CREW_BATCH_SIZE))
    } catch (err) {
      crew_queue_failed = true
      console.error('[lineage] skipping lineage this run:', err instanceof Error ? err.message : err)
    }
  }

  for (let i = 0; i < crewQueue.length; i += TITLE_BATCH_SIZE) {
    if (callsLeft() < CREW_COST) { budget_exhausted = true; break }
    const batch = crewQueue.slice(i, i + TITLE_BATCH_SIZE)

    await Promise.allSettled(
      batch.map(async ({ tmdb_person_id, name }) => {
        const outcome = await attempt(
          'lineage',
          `${tmdb_person_id} (${name})`,
          CREW_COST,
          async () => {
            const ok = await buildLineageGraph(tmdb_person_id)
            if (ok) {
              crew_processed++
            }
            // buildLineageGraph returns false if already enriched — not an error
          },
          () => { crew_failed++ },
        )
        if (outcome === 'wall') rate_limited = true
        if (outcome === 'budget') budget_exhausted = true
      })
    )
    if (rate_limited || budget_exhausted) break

    if (i + TITLE_BATCH_SIZE < crewQueue.length) {
      await sleep(BATCH_DELAY_MS)
    }
  }

  return {
    titles_processed,
    titles_failed,
    crew_processed,
    crew_failed,
    duration_ms: Date.now() - start,
    mistral_calls: mistralCallCount() - callsAtStart,
    rate_limited,
    budget_exhausted,
    crew_queue_failed,
  }
}
