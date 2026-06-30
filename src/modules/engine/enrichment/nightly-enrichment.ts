/**
 * runNightlyEnrichment
 *
 * Processes the enrichment backlog: titles in `titles` where enriched_at IS NULL.
 * Called by POST /api/cron/enrich (protected by CRON_SECRET).
 *
 * Runs in batches of 5 titles with a delay between batches to stay within
 * Groq's free-tier rate limits (~30 RPM on llama-3.3-70b-versatile).
 *
 * Also runs buildLineageGraph for any crew members without lineage data,
 * capped at 20 per run to keep the job short.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { enrichTitleWithNarrative } from './enrich-title-narrative'
import { buildLineageGraph } from './build-lineage-graph'

const TITLE_BATCH_SIZE = 5
const CREW_BATCH_SIZE = 20
const BATCH_DELAY_MS = 2500   // ~24 title requests/min — well within Groq free tier

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
    .select('tmdb_id, title')
    .is('enriched_at', null)
    .order('created_at', { ascending: true })
    .limit(50)

  const titleQueue = pendingTitles ?? []

  for (let i = 0; i < titleQueue.length; i += TITLE_BATCH_SIZE) {
    const batch = titleQueue.slice(i, i + TITLE_BATCH_SIZE)

    await Promise.allSettled(
      batch.map(async ({ tmdb_id, title }) => {
        try {
          const ok = await enrichTitleWithNarrative(tmdb_id)
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
  // Only run if we have capacity (Groq budget). Each buildLineageGraph
  // call costs 1 Groq request. Cap at CREW_BATCH_SIZE per run.
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

  for (let i = 0; i < crewQueue.length; i += 5) {
    const batch = crewQueue.slice(i, i + 5)

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

    if (i + 5 < crewQueue.length) {
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
