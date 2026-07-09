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
