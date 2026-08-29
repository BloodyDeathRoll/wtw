/**
 * backfill-language-keywords — fill titles.original_language + titles.keywords
 * for the existing catalog (migration 0021).
 *
 * New titles get both at seed time (fetchAndCacheTitle). Everything cached
 * before 0021 has original_language NULL and keywords '[]', which is what made
 * every category exclusion rule a no-op: "no anime" has nothing to match on,
 * because anime is not a TMDB genre — it is Animation + Japanese, and TMDB
 * carries it as a keyword.
 *
 * Prereq: migration 0021 applied.
 *
 *   npm run backfill-language-keywords              # walk the whole backlog
 *   LIMIT=500 npm run backfill-language-keywords    # cap this run
 *
 * Idempotent: the backlog is "original_language is null", so re-running picks
 * up only what is still unfilled. Rows TMDB 404s on are marked with the
 * sentinel 'xx' so a dead id can't stall the backlog forever — 'xx' is TMDB's
 * own code for "no language", and no exclusion rule maps to it.
 *
 * ~15k titles at 260ms ≈ 65 minutes. Safe to interrupt and resume.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { getMovie, getTV } from '@/lib/tmdb'

function intEnv(name: string, def: number): number {
  const v = process.env[name]
  const n = v == null ? def : parseInt(v, 10)
  return Number.isFinite(n) ? n : def
}

const LIMIT    = intEnv('LIMIT', 100000)
const PAGE     = 1000
const SLEEP_MS = intEnv('SLEEP_MS', 260) // TMDB free tier: 40 req / 10s

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const db = createServiceClient()

  // Collect the whole backlog first: the filter is on the column this script
  // writes, so paginating while writing would skip rows as they shift out.
  const backlog: { tmdb_id: string; type: 'movie' | 'tv' }[] = []
  for (let from = 0; ; from += PAGE) {
    const { data: rows, error } = await db
      .from('titles')
      .select('tmdb_id, type')
      .is('original_language', null)
      .order('tmdb_id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`Cannot read titles: ${error.message}`)
    if (!rows || rows.length === 0) break
    for (const r of rows) backlog.push({ tmdb_id: r.tmdb_id as string, type: r.type as 'movie' | 'tv' })
    if (rows.length < PAGE) break
  }

  console.log(`[lang-kw] backlog: ${backlog.length} titles`)

  let processed = 0, filled = 0, missing = 0, errors = 0, withKeywords = 0

  for (const { tmdb_id, type } of backlog) {
    if (processed >= LIMIT) break
    try {
      const detail = type === 'movie' ? await getMovie(tmdb_id) : await getTV(tmdb_id)
      processed++

      if (!detail) {
        // TMDB no longer has this id. Sentinel so it leaves the backlog.
        missing++
        await db.from('titles').update({ original_language: 'xx' })
          .eq('tmdb_id', tmdb_id).eq('type', type)
        continue
      }

      const { error: upErr } = await db
        .from('titles')
        .update({
          original_language: detail.original_language ?? 'xx',
          keywords: detail.keywords,
        })
        .eq('tmdb_id', tmdb_id)
        .eq('type', type) // composite key (migration 0008)

      if (upErr) { errors++; console.error(`[lang-kw] update ${type} ${tmdb_id} failed:`, upErr.message) }
      else {
        filled++
        if (detail.keywords.length > 0) withKeywords++
      }
    } catch (e) {
      errors++
      console.error(`[lang-kw] fetch ${type} ${tmdb_id} failed:`, e instanceof Error ? e.message : e)
    }

    if (processed % 250 === 0) {
      console.log(`[lang-kw] progress: processed=${processed} filled=${filled} kw=${withKeywords} gone=${missing} err=${errors}`)
    }
    await sleep(SLEEP_MS)
  }

  const summary = { ok: true, backlog: backlog.length, processed, filled, with_keywords: withKeywords, missing, errors }
  console.log('[lang-kw] done:', JSON.stringify(summary))
}

main().catch((err) => {
  console.error('[lang-kw] FATAL:', err)
  console.log(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }))
  process.exit(1)
})
