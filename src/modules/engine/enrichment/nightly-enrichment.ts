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

const TITLE_BATCH_SIZE = 1    // STRICTLY serial — one enrichment call at a time
const TITLE_LIMIT = 10        // titles enriched per run
const CREW_BATCH_SIZE = 5     // crew lineage rows per run
// Sized so a full run finishes well inside the cron's 300s cap. Honest budget:
// each title = generateObject + embed (2 calls); each crew = getPerson +
// generateObject + parallel searches. With BATCH_DELAY_MS between every serial
// call (9 title gaps + 4 crew gaps = 13*5s = 65s of delay) plus ~5-7s work per
// item, a run is ~200s — comfortable margin under 300s even with retries /
// free-tier latency variance. The Dream drain loop re-invokes until empty, so
// a small per-run slice costs nothing but iterations.
const BATCH_DELAY_MS = 5000   // ~5s between calls → ~10 req/min, safely inside
                              // Mistral's free tier (50K TPM / 50 req-min). Serial.

export interface EnrichmentReport {
  titles_processed: number
  titles_failed: number
  crew_processed: number
  crew_failed: number
  duration_ms: number
}

export async function runNightlyEnrichment(): Promise<EnrichmentReport> {
  const start = Date.now()
  const supabase = createServiceClient()

  let titles_processed = 0
  let titles_failed = 0
  let crew_processed = 0
  let crew_failed = 0

  // ── Phase 1: Enrich pending titles ───────────────────────
  const { data: pendingTitles } = await supabase
    .from('titles')
    .select('tmdb_id, title, type')
    .is('enriched_at', null)
    .order('created_at', { ascending: true })
    .limit(TITLE_LIMIT)

  const titleQueue = pendingTitles ?? []

  for (let i = 0; i < titleQueue.length; i += TITLE_BATCH_SIZE) {
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
          console.error(`[enrich] Failed ${tmdb_id} (${title}):`, err)
        }
      })
    )

    // Delay between batches — skip delay after last batch
    if (i + TITLE_BATCH_SIZE < titleQueue.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS))
    }
  }

  // ── Phase 2: Build lineage for pending crew members ──────
  // Each buildLineageGraph call costs 1 Mistral request. Cap at
  // CREW_BATCH_SIZE per run, same serial concurrency + delay as titles.
  const { data: pendingCrew } = await supabase
    .from('crew_members')
    .select('tmdb_person_id, name, primary_role')
    .is('enriched_at', null)
    .in('primary_role', ['director', 'writer', 'cinematographer'])
    // Only build lineage for the roles that matter for scoring.
    // Actors are excluded — lineage boost only applies to crew.
    .order('created_at', { ascending: true })
    .limit(CREW_BATCH_SIZE)

  const crewQueue = pendingCrew ?? []

  for (let i = 0; i < crewQueue.length; i += TITLE_BATCH_SIZE) {
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
          console.error(`[lineage] Failed ${tmdb_person_id} (${name}):`, err)
        }
      })
    )

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
  }
}
