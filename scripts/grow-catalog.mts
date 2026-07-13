/**
 * grow-catalog — nightly catalog growth + enrichment (standalone, zero Claude quota)
 *
 * Runs headless with no Next.js dev server. Reuses the exact app enrichment
 * modules (so the tone-repair fix etc. never drift), driving them directly
 * against Supabase + TMDB + Mistral. Invoked by the Dream automation platform's
 * `wtw-catalog` assignment inside the nightly window, but also runnable by hand:
 *
 *   npm run grow-catalog                 # defaults below
 *   SEED_COUNT=0 npm run grow-catalog    # enrich-only (drain backlog, no growth)
 *   SEED_COUNT=100 TARGET_CATALOG=5000 npm run grow-catalog
 *
 * Budget note: Dream's guard only protects your Claude Max quota — it does NOT
 * know about Mistral. So this script self-limits: it seeds at most SEED_COUNT
 * new titles per run and stops growing once the catalog reaches TARGET_CATALOG.
 * Enrichment then drains whatever is pending (new titles + existing backlog),
 * capped at ENRICH_MAX titles per run to stay polite to the free tier.
 *
 * Exit code is always 0 on a completed run (partial progress is success);
 * non-zero only on a hard misconfiguration (missing env). Prints a JSON
 * summary as its LAST stdout line so run.sh can log it into the digest.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { discoverVaried, getMovie, getTV } from '@/lib/tmdb'
import { fetchAndCacheTitle } from '@/modules/engine/enrichment/fetch-and-cache-title'
import { runNightlyEnrichment } from '@/modules/engine/enrichment/nightly-enrichment'

// (tmdb_id, type) is the real title key — TMDB movie/tv ids share a namespace.
const key = (type: string, tmdb_id: string) => `${type}:${tmdb_id}`

// ── Tunables (env-overridable; Dream's run.sh sets these) ───────────────────
const SEED_COUNT       = intEnv('SEED_COUNT', 120)       // new titles to add per run
const TARGET_CATALOG   = intEnv('TARGET_CATALOG', 15000) // stop growing at this size
const ENRICH_MAX       = intEnv('ENRICH_MAX', 300)       // max titles to enrich per run
const DISCOVER_CAP     = intEnv('DISCOVER_CAP', 40)      // max TMDB discover pages to scan
const TRAILER_BACKFILL = intEnv('TRAILER_BACKFILL', 150) // trailer_key NULL rows to re-check per run

function intEnv(name: string, def: number): number {
  const v = process.env[name]
  const n = v == null ? def : parseInt(v, 10)
  return Number.isFinite(n) ? n : def
}

// TMDB genre ids — movie + TV, a spread that favours breadth of taste.
const MOVIE_GENRES = [28, 12, 16, 35, 80, 18, 14, 27, 9648, 10749, 878, 53, 37]
const TV_GENRES    = [10759, 16, 35, 80, 18, 9648, 10765, 37]
// Decade windows so growth isn't all recent releases.
const DECADES: [number, number][] = [
  [2020, 2029], [2010, 2019], [2000, 2009], [1990, 1999], [1980, 1989], [1970, 1979],
]

async function main() {
  const db = createServiceClient()

  // ── 0. Current catalog size + known (tmdb_id, type) keys (one query) ───────
  const { data: existing, error } = await db.from('titles').select('tmdb_id, type')
  if (error) throw new Error(`Cannot read titles: ${error.message}`)
  const known = new Set<string>(
    (existing ?? []).map((r) => key(r.type as string, r.tmdb_id as string)),
  )
  const startCount = known.size

  // ── 1. Seed new titles (variety sweep), bounded by budget + target ────────
  let seeded = 0
  const remainingToTarget = Math.max(0, TARGET_CATALOG - startCount)
  const seedBudget = Math.min(SEED_COUNT, remainingToTarget)

  if (seedBudget > 0) {
    outer: for (let attempt = 0; attempt < DISCOVER_CAP; attempt++) {
      // Rotate a deterministic slice: type × genre × decade × page, offset by
      // how many titles exist so successive nights explore fresh combinations.
      const salt = startCount + attempt
      const type: 'movie' | 'tv' = salt % 3 === 0 ? 'tv' : 'movie'
      const genres = type === 'movie' ? MOVIE_GENRES : TV_GENRES
      const genreId = genres[salt % genres.length]
      const [yearGte, yearLte] = DECADES[salt % DECADES.length]
      const page = (Math.floor(salt / DECADES.length) % 5) + 1

      let candidates
      try {
        candidates = await discoverVaried(type, { genreId, yearGte, yearLte, page })
      } catch (e) {
        console.error(`[grow] discover slice failed (${type} g${genreId} ${yearGte}s p${page}):`, e)
        await sleep(1000) // back off before the next slice — a TMDB 429/5xx
                          // shouldn't trigger DISCOVER_CAP rapid-fire retries
        continue
      }

      for (const item of candidates) {
        if (known.has(key(item.type, item.tmdb_id))) continue
        try {
          const ok = await fetchAndCacheTitle(item.tmdb_id, item.type)
          if (ok) {
            known.add(key(item.type, item.tmdb_id))
            seeded++
            if (seeded >= seedBudget) break outer
          }
        } catch (e) {
          console.error(`[grow] cache ${item.type} ${item.tmdb_id} failed:`, e)
        }
        await sleep(260) // TMDB rate-limit courtesy (40 req / 10s)
      }
    }
  }

  // ── 2. Enrich pending titles (new + existing backlog), capped per run ─────
  // runNightlyEnrichment processes up to its own internal batch each call and
  // is idempotent (only touches enriched_at IS NULL); loop until the backlog is
  // empty, ENRICH_MAX is reached, or a run makes no progress (rate-limit wall).
  let enriched = 0
  let enrichFailures = 0
  let stalls = 0
  while (enriched < ENRICH_MAX && stalls < 2) {
    const report = await runNightlyEnrichment()
    enriched += report.titles_processed
    enrichFailures += report.titles_failed
    if (report.titles_processed === 0) stalls++
    else stalls = 0
    if (report.titles_processed === 0 && report.crew_processed === 0) break
  }

  // ── 3. Backfill posters for any rows still missing one ────────────────────
  let postersBackfilled = 0
  const { data: noPoster } = await db
    .from('titles')
    .select('tmdb_id, type')
    .is('poster_path', null)
    .limit(SEED_COUNT + 50)
  for (const row of noPoster ?? []) {
    try {
      const detail =
        row.type === 'movie'
          ? await getMovie(row.tmdb_id as string)
          : await getTV(row.tmdb_id as string)
      if (detail?.poster_path) {
        await db.from('titles').update({ poster_path: detail.poster_path })
          .eq('tmdb_id', row.tmdb_id).eq('type', row.type)  // composite key (0008)
        postersBackfilled++
      }
    } catch {
      /* best-effort */
    }
    await sleep(150)
  }

  // ── 3b. Backfill trailers for a ROTATING slice of the NULL backlog ────────
  // New titles capture trailer_key at seed time (fetchAndCacheTitle). This heals
  // the pre-trailer backlog + catches trailers that appear after release. The
  // window rotates by catalog size each night so successive runs sweep the whole
  // NULL set over time rather than re-checking the same first N forever. Titles
  // with genuinely no trailer stay NULL and get re-checked on a later sweep —
  // cheap TMDB calls (append_to_response=videos rides the existing detail fetch).
  let trailersBackfilled = 0
  if (TRAILER_BACKFILL > 0) {
    const { count: nullCount } = await db
      .from('titles')
      .select('tmdb_id', { count: 'exact', head: true })
      .is('trailer_key', null)
    if (nullCount && nullCount > 0) {
      const windowStart = startCount % nullCount
      const { data: rows } = await db
        .from('titles')
        .select('tmdb_id, type')
        .is('trailer_key', null)
        .order('tmdb_id', { ascending: true })
        .range(windowStart, windowStart + TRAILER_BACKFILL - 1)
      for (const row of rows ?? []) {
        try {
          const detail =
            row.type === 'movie'
              ? await getMovie(row.tmdb_id as string)
              : await getTV(row.tmdb_id as string)
          if (detail?.trailer_key) {
            await db.from('titles').update({ trailer_key: detail.trailer_key })
              .eq('tmdb_id', row.tmdb_id).eq('type', row.type) // composite key (0008)
            trailersBackfilled++
          }
        } catch {
          /* best-effort */
        }
        await sleep(260) // TMDB courtesy (40 req / 10s)
      }
    }
  }

  // ── 4. Final counts + JSON summary (LAST line) ────────────────────────────
  const [{ count: total }, { count: enrichedTotal }] = await Promise.all([
    db.from('titles').select('tmdb_id', { count: 'exact', head: true }),
    db.from('titles').select('tmdb_id', { count: 'exact', head: true }).not('enriched_at', 'is', null),
  ])

  const summary = {
    ok: true,
    started_titles: startCount,
    seeded,
    enriched,
    enrich_failures: enrichFailures,
    posters_backfilled: postersBackfilled,
    trailers_backfilled: trailersBackfilled,
    total_titles: total ?? null,
    enriched_total: enrichedTotal ?? null,
    target: TARGET_CATALOG,
    growth_complete: (total ?? 0) >= TARGET_CATALOG,
  }
  console.log('[grow] done:', `seeded=${seeded} enriched=${enriched} trailers=${trailersBackfilled} total=${total}/${TARGET_CATALOG}`)
  console.log(JSON.stringify(summary))
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

main().catch((err) => {
  console.error('[grow] FATAL:', err)
  console.log(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }))
  process.exit(1)
})
