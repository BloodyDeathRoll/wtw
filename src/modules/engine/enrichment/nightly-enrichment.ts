/**
 * runNightlyEnrichment
 *
 * Processes the enrichment backlog: titles in `titles` where enriched_at IS NULL.
 * Called by POST /api/cron/enrich (protected by CRON_SECRET).
 *
 * Runs strictly serially with a delay between calls to stay inside the
 * enrichment LLM's free-tier rate limits — see MODELS.enrichment in
 * src/lib/ai-models.ts for the current provider and its measured limits.
 *
 * Also runs buildLineageGraph for any crew members without lineage data,
 * capped at CREW_BATCH_SIZE per run to keep the job short.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { enrichTitleWithNarrative } from './enrich-title-narrative'
import { buildLineageGraph } from './build-lineage-graph'
import { isMistralRateLimit, mistralCallCount } from '@/lib/mistral-batch'

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
  /** Mistral answered 429. The run stopped at that point — see below. */
  rate_limited: boolean
  /** The caller's call budget ran out before the backlog did. */
  budget_exhausted: boolean
}

export interface EnrichmentOptions {
  /**
   * Stop before the next item once this many Mistral calls have been made in
   * this run. A title costs 2 (extraction + embedding), a crew row 1. The
   * caller (grow-catalog) turns its nightly budget into this per-call cap.
   */
  maxMistralCalls?: number
}

// One 429 means the key is spent for now — every further call is a wasted
// request against the same wall (2026-09-04: 15 of 15 attempts failed, two
// nights running, three retries each). Stop the run on the first one.
const TITLE_COST = 2
const CREW_COST = 1

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
        try {
          const ok = await enrichTitleWithNarrative(tmdb_id, type as 'movie' | 'tv')
          if (ok) {
            titles_processed++
          } else {
            console.warn(`[enrich] Skipped ${tmdb_id} (${title}) — not found in DB`)
          }
        } catch (err) {
          titles_failed++
          if (isMistralRateLimit(err)) {
            rate_limited = true
            console.error(`[enrich] Mistral rate limit (429) on ${tmdb_id} (${title}) — stopping this run`)
          } else {
            console.error(`[enrich] Failed ${tmdb_id} (${title}):`, err)
          }
        }
      })
    )
    if (rate_limited) break

    // Delay between batches — skip delay after last batch
    if (i + TITLE_BATCH_SIZE < titleQueue.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS))
    }
  }

  // ── Phase 2: Build lineage for pending crew members ──────
  // Each buildLineageGraph call costs 1 Mistral request. Cap at
  // CREW_BATCH_SIZE per run, same serial concurrency + delay as titles.
  // A rate-limited or over-budget run skips lineage too: same key, same wall.
  const crewQueue = rate_limited || budget_exhausted ? [] : await selectQueue('crew', () => supabase
    .from('crew_members')
    .select('tmdb_person_id, name, primary_role')
    .is('enriched_at', null)
    .in('primary_role', ['director', 'writer', 'cinematographer'])
    // Only build lineage for the roles that matter for scoring.
    // Actors are excluded — lineage boost only applies to crew.
    .order('created_at', { ascending: true })
    .limit(CREW_BATCH_SIZE))

  for (let i = 0; i < crewQueue.length; i += TITLE_BATCH_SIZE) {
    if (callsLeft() < CREW_COST) { budget_exhausted = true; break }
    const batch = crewQueue.slice(i, i + TITLE_BATCH_SIZE)

    await Promise.allSettled(
      batch.map(async ({ tmdb_person_id, name }) => {
        try {
          const ok = await buildLineageGraph(tmdb_person_id)
          if (ok) {
            crew_processed++
          }
          // buildLineageGraph returns false if already enriched — not an error
        } catch (err) {
          crew_failed++
          if (isMistralRateLimit(err)) {
            rate_limited = true
            console.error(`[lineage] Mistral rate limit (429) on ${tmdb_person_id} (${name}) — stopping this run`)
          } else {
            console.error(`[lineage] Failed ${tmdb_person_id} (${name}):`, err)
          }
        }
      })
    )
    if (rate_limited) break

    if (i + TITLE_BATCH_SIZE < crewQueue.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS))
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
  }
}
