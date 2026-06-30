/**
 * POST /api/admin/seed
 *
 * One-time operation: populates the `titles` table from TMDB Discover and
 * runs the first round of narrative enrichment. Safe to re-run — all
 * upserts are idempotent (ON CONFLICT DO UPDATE / ignoreDuplicates).
 *
 * Protected by CRON_SECRET. Call once after deploying migrations.
 *
 * Body (all optional):
 * {
 *   discover_pages?: number   // pages of TMDB Discover to fetch (default 10 = ~200 titles)
 *   enrich?: boolean          // run first enrichment pass immediately (default true)
 * }
 *
 * Response:
 * {
 *   seeded:            number   // titles upserted from TMDB
 *   seed_errors:       number
 *   titles_enriched:   number   // narrative metadata + embeddings generated
 *   titles_failed:     number
 *   crew_enriched:     number   // lineage graphs built
 *   duration_ms:       number
 * }
 *
 * How to call (from terminal once env vars are set):
 *   curl -X POST https://your-app.vercel.app/api/admin/seed \
 *     -H "Authorization: Bearer <CRON_SECRET>" \
 *     -H "Content-Type: application/json" \
 *     -d '{"discover_pages": 10, "enrich": true}'
 *
 * Or locally with npm run dev running:
 *   curl -X POST http://localhost:3000/api/admin/seed \
 *     -H "Authorization: Bearer <CRON_SECRET>" \
 *     -H "Content-Type: application/json" \
 *     -d '{"discover_pages": 5, "enrich": true}'
 */

import { NextRequest, NextResponse } from 'next/server'
import { discoverAndSeed } from '@/modules/engine/enrichment/fetch-and-cache-title'
import { runNightlyEnrichment } from '@/modules/engine/enrichment/nightly-enrichment'

export async function POST(req: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────
  const authHeader = req.headers.get('authorization')
  const secret = process.env.CRON_SECRET

  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Parse body ────────────────────────────────────────────
  const body = await req.json().catch(() => ({}))
  const discover_pages: number = body.discover_pages ?? 10
  const enrich: boolean        = body.enrich ?? true

  const start = Date.now()

  // ── Phase 1: Seed titles from TMDB Discover ───────────────
  // Fetches discover_pages × 20 movies + discover_pages × 20 TV shows.
  // Each title is fetched with full crew + OMDB ratings in one shot.
  // Rate-limited to ~4 titles/second to stay inside TMDB free tier.
  console.log(`[seed] Starting: ${discover_pages} pages of movies + TV (~${discover_pages * 40} titles)`)

  const { seeded, errors: seed_errors } = await discoverAndSeed(discover_pages)
  console.log(`[seed] Phase 1 done: ${seeded} seeded, ${seed_errors} errors`)

  // ── Phase 2: First enrichment pass (optional) ─────────────
  // Calls Groq to extract narrative dimensions + Mistral for embeddings.
  // Processes 50 titles per run, batched at 5 to stay inside Groq free tier.
  // The nightly cron will continue enriching the rest automatically.
  let enrichReport = {
    titles_processed: 0,
    titles_failed: 0,
    crew_processed: 0,
    crew_failed: 0,
    duration_ms: 0,
  }

  if (enrich) {
    console.log('[seed] Starting Phase 2: narrative enrichment (first 50 titles)...')
    enrichReport = await runNightlyEnrichment()
    console.log('[seed] Phase 2 done:', enrichReport)
  }

  return NextResponse.json({
    seeded,
    seed_errors,
    titles_enriched: enrichReport.titles_processed,
    titles_failed:   enrichReport.titles_failed,
    crew_enriched:   enrichReport.crew_processed,
    duration_ms:     Date.now() - start,
  })
}
