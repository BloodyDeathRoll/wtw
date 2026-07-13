/**
 * backfill-trailers — one-time trailer harvest for the EXISTING catalog
 *
 * New titles get their trailer_key at seed time (fetchAndCacheTitle now stores
 * it). This script fills the gap for titles cached before trailer harvesting
 * existed: it collects every row whose trailer_key IS NULL, re-fetches the TMDB
 * detail (now with append_to_response=videos), and writes the picked YouTube
 * key when one exists.
 *
 * Prereq: migration 0011_titles_trailer_key.sql must be applied first.
 *
 *   npm run backfill-trailers                 # walk the whole NULL backlog
 *   LIMIT=200 npm run backfill-trailers       # cap this run (safe to re-run)
 *
 * Titles with genuinely no trailer stay NULL (nothing to store). Re-running is
 * idempotent — it re-scans the still-NULL rows — so run it to completion once,
 * not nightly. Best-effort per title; prints a JSON summary as its LAST line.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { getMovie, getTV } from '@/lib/tmdb'

function intEnv(name: string, def: number): number {
  const v = process.env[name]
  const n = v == null ? def : parseInt(v, 10)
  return Number.isFinite(n) ? n : def
}

const LIMIT    = intEnv('LIMIT', 100000) // max titles to process this run
const PAGE     = 1000                    // DB read page size (Supabase max per req)
const SLEEP_MS = intEnv('SLEEP_MS', 260) // TMDB courtesy (40 req / 10s free tier)

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function main() {
  const db = createServiceClient()

  // ── 1. Collect the whole NULL backlog FIRST (no writes yet, so the filter
  //       is stable and range pagination can't skip shifting rows) ───────────
  const backlog: { tmdb_id: string; type: 'movie' | 'tv' }[] = []
  for (let from = 0; ; from += PAGE) {
    const { data: rows, error } = await db
      .from('titles')
      .select('tmdb_id, type')
      .is('trailer_key', null)
      .order('tmdb_id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`Cannot read titles: ${error.message}`)
    if (!rows || rows.length === 0) break
    for (const r of rows) backlog.push({ tmdb_id: r.tmdb_id as string, type: r.type as 'movie' | 'tv' })
    if (rows.length < PAGE) break
  }

  console.log(`[trailers] backlog: ${backlog.length} titles without a trailer_key`)

  // ── 2. Fetch + update, best-effort, rate-limited ──────────────────────────
  let processed = 0
  let withTrailer = 0
  let noTrailer = 0
  let errors = 0

  for (const { tmdb_id, type } of backlog) {
    if (processed >= LIMIT) break
    try {
      const detail = type === 'movie' ? await getMovie(tmdb_id) : await getTV(tmdb_id)
      processed++
      if (detail?.trailer_key) {
        const { error: upErr } = await db
          .from('titles')
          .update({ trailer_key: detail.trailer_key })
          .eq('tmdb_id', tmdb_id)
          .eq('type', type) // composite key (migration 0008)
        if (upErr) { errors++; console.error(`[trailers] update ${type} ${tmdb_id} failed:`, upErr.message) }
        else withTrailer++
      } else {
        noTrailer++ // genuinely no trailer — stays NULL
      }
    } catch (e) {
      errors++
      console.error(`[trailers] fetch ${type} ${tmdb_id} failed:`, e instanceof Error ? e.message : e)
    }
    if (processed % 250 === 0) {
      console.log(`[trailers] progress: processed=${processed} found=${withTrailer} none=${noTrailer} err=${errors}`)
    }
    await sleep(SLEEP_MS)
  }

  const summary = { ok: true, backlog: backlog.length, processed, with_trailer: withTrailer, no_trailer: noTrailer, errors }
  console.log('[trailers] done:', `processed=${processed} found=${withTrailer} none=${noTrailer} err=${errors}`)
  console.log(JSON.stringify(summary))
}

main().catch((err) => {
  console.error('[trailers] FATAL:', err)
  console.log(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }))
  process.exit(1)
})
