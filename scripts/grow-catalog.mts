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
const DISCOVER_CAP     = intEnv('DISCOVER_CAP', 40)      // max discover slices/attempts to scan
const DISCOVER_PAGES   = Math.max(1, intEnv('DISCOVER_PAGES', 5)) // TMDB page depth per genre×decade
                                                         // slice. Sets the REACHABLE pool:
                                                         // types×genres×decades×PAGES×20.
                                                         // 5 → ~12.6k (< 15k target); 15 →
                                                         // ~37.8k. Higher pages = less
                                                         // popular titles (see VOTE_FLOOR).
                                                         // DO NOT turn this knob on a theory —
                                                         // it has been raised twice on a dupe
                                                         // rate back-inferred from an assumed
                                                         // pages×20, and the formula above was
                                                         // simply FALSE until the SLICES table
                                                         // below made it true. It counts SLOTS,
                                                         // not distinct titles: a title with two
                                                         // genres fills a slot in two slices of
                                                         // the same decade, and that
                                                         // de-duplication factor has never been
                                                         // measured. The summary now reports
                                                         // slices_scanned, candidates_seen and
                                                         // seed_attempts, so BOTH halves are
                                                         // observable nightly — take two or
                                                         // three nights of them, then set this
                                                         // from the measured ratios:
                                                         //   depth = candidates_seen/slices_scanned
                                                         //           (how full a page really is;
                                                         //            << 20 means the pool at this
                                                         //            depth is already exhausted
                                                         //            and MORE pages buy nothing)
                                                         //   dupes = 1 - seed_attempts/candidates_seen
                                                         //           (how much of a full page we
                                                         //            already hold; high with a
                                                         //            full depth means deeper
                                                         //            pages WOULD hold new titles)
                                                         // Do NOT use seeded/(slices_scanned×20):
                                                         // the ×20 is the same assumed page size
                                                         // this note warns about above, and it
                                                         // gives the SAME number for both cases,
                                                         // which want opposite knob moves.
const DISCOVER_OFFSET  = intEnv('DISCOVER_OFFSET', -1)   // resume cursor into SLICES, owned and
                                                         // persisted by the caller (Dream's
                                                         // run.sh). < 0 or unset → fall back to
                                                         // the old catalog-size anchor so a
                                                         // hand-run still behaves as before.
const SEED_ATTEMPT_CAP = intEnv('SEED_ATTEMPT_CAP', -1)  // hard ceiling on OMDB-costing seed
                                                         // ATTEMPTS. SEED_COUNT caps successes,
                                                         // but fetchAndCacheTitle spends the OMDB
                                                         // lookup before the upsert that can
                                                         // throw, so a night with a failure rate
                                                         // keeps paying until SEED_COUNT titles
                                                         // land. Measured with a 1-in-3 upsert
                                                         // failure rate: 1,349 lookups for a 900
                                                         // budget — 35% over the 1,000/day OMDB
                                                         // ceiling that budget was sized against.
                                                         // -1 (unset) → derive as
                                                         // ceil(seedBudget × 1.1), which keeps 900
                                                         // inside 1,000 while absorbing a 10%
                                                         // failure rate without costing yield.
                                                         // 0 → NO cap, same as every other 0-means-
                                                         // off knob in this file. Use it only with
                                                         // OMDB headroom you have checked.
const TRAILER_BACKFILL = intEnv('TRAILER_BACKFILL', 150) // trailer_key NULL rows to re-check per run
const TRAILER_RECHECK_DAYS = intEnv('TRAILER_RECHECK_DAYS', 30)
                                                         // minimum age before a trailerless row is
                                                         // re-checked. The rotation alone cycles the
                                                         // 1,134-row NULL backlog every 7.6 nights at
                                                         // 150/run — ~4 re-fetches a month per row for
                                                         // a measured yield of 10 trailers per ~2,700
                                                         // calls (18 committed summaries). A 30-day
                                                         // floor makes that ~1/month. 0 → no floor
                                                         // (pre-proposal behaviour).
const POSTER_BACKFILL  = intEnv('POSTER_BACKFILL', 150)  // poster_path NULL rows to re-check per run.
                                                         // Deliberately NOT derived from SEED_COUNT —
                                                         // the poster backlog is unrelated to the seed
                                                         // budget, and an enrich-only run (SEED_COUNT=0)
                                                         // used to shrink this batch to 50.

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

// Minimum TMDB vote count per (type, decade). discoverVaried defaults to 40,
// which is the right floor for a recommendation catalog — it keeps unrated
// noise out — but spending it UNIFORMLY biases toward blockbusters exactly
// where the breadth goal cares most: TMDB simply holds fewer well-voted titles
// the further back you go, so a flat 40 caps the thin decades far below the
// page depth DISCOVER_PAGES already pays for.
//
// Measured against live TMDB 2026-08-14 — count of slices (genre×decade) whose
// whole pool is under DISCOVER_PAGES×20 = 300 titles, i.e. where page depth is
// wasted because the floor binds first:
//
//   movie  2020s 1/13   2010s 1/13   2000s 1/13   1990s 3/13   1980s 4/13   1970s 7/13
//   tv     2020s 1/8    2010s 1/8    2000s 4/8    1990s 8/8    1980s 8/8    1970s 8/8
//
// The floors below are the loosest value that stops the floor from being the
// binding constraint in that decade (1970s/80s TV is genuinely tiny — 154 and
// 286 titles all-genres — so no floor rescues it; 10 is where it stops
// improving). Relaxing only where the pool is thin is what makes this safe:
// aggregate reachable titles go from ~44,988 to ~51,360 (+14%), and every one
// of those 6,372 is pre-2000. Do not flatten this to a single lower number —
// that trades quality for breadth in the decades that never needed it.
const VOTE_FLOOR: Record<'movie' | 'tv', Record<number, number>> = {
  movie: { 2020: 40, 2010: 40, 2000: 40, 1990: 25, 1980: 25, 1970: 15 },
  tv:    { 2020: 40, 2010: 40, 2000: 25, 1990: 15, 1980: 10, 1970: 10 },
}

// The sweep space, enumerated as the FULL product table.
//
// It used to be derived arithmetically from a single `salt`: type = salt%3,
// decade = salt%6. Those are not independent — 6 is a multiple of 3, so the
// decade index DICTATED the type. Only 60 of the 126 type×genre×decade
// combinations were reachable and the split was total: movies only from the
// 1970s/80s/2000s/2010s, TV only from the 1990s/2020s. No 2020s film and no
// 2010s series could EVER be seeded, and the pool was 60×PAGES×20, not the
// 126×PAGES×20 the DISCOVER_PAGES note above assumes (18k vs 37.8k at
// PAGES=15 — under the 15,000 target once cross-genre duplicates are removed,
// which is why growth asymptotes short of it).
//
// Ordered decade-fastest, then type, then genre, then page, so a partial night
// still seeds for breadth and page 1 (the most popular titles) is swept before
// page 2. Every contiguous window of ≥6 slices spans all six decades.
//
// It does NOT guarantee both types in every window: MOVIE_GENRES is 13 long
// and TV_GENRES only 8, so the genre indices past the short list emit movies
// alone — the last 30 slices of each page (g=8..12 × 6 decades) are movie-only.
// Harmless at the DISCOVER_CAP the nightly job actually uses (400 — see Dream's
// assignments/wtw-catalog/manifest.yaml), which spans >3 pages and cannot land
// inside that tail. A hand-run with a cap under ~30 starting in the tail would
// seed no series that run; widen the cap rather than reordering. Do NOT "fix"
// it by cycling the short list (`genres[g % genres.length]`) — that re-emits
// TV genres 0–4 as 30 duplicate slices per page, spending the discover call
// twice for a near-100% dupe rate and inflating slice_space with slices that
// cannot yield.
type Slice = {
  type: 'movie' | 'tv'
  genreId: number
  yearGte: number
  yearLte: number
  page: number
  voteCountGte: number
}
const SLICES: Slice[] = (() => {
  const out: Slice[] = []
  const byType = [['movie', MOVIE_GENRES], ['tv', TV_GENRES]] as const
  const maxGenres = Math.max(MOVIE_GENRES.length, TV_GENRES.length)
  for (let page = 1; page <= DISCOVER_PAGES; page++) {
    for (let g = 0; g < maxGenres; g++) {
      for (const [type, genres] of byType) {
        if (g >= genres.length) continue
        for (const [yearGte, yearLte] of DECADES) {
          out.push({
            type,
            genreId: genres[g],
            yearGte,
            yearLte,
            page,
            voteCountGte: VOTE_FLOOR[type][yearGte] ?? 40,
          })
        }
      }
    }
  }
  return out
})()

async function main() {
  const db = createServiceClient()

  // ── 0. Current catalog size + known (tmdb_id, type) keys ────────────────────
  // PostgREST caps a single select at 1000 rows, so an unpaginated query silently
  // sees only the first 1000 titles — dedup then goes blind past that and re-seeds
  // (upserts) existing rows, inflating `seeded` with no net growth (started_titles
  // froze at 1000 while the catalog grew; fixed 2026-07-15). Page through .range()
  // until a short page returns so `known` holds the WHOLE catalog.
  const known = new Set<string>()
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data: rows, error } = await db
      .from('titles')
      .select('tmdb_id, type')
      .order('tmdb_id', { ascending: true })
      .order('type', { ascending: true }) // (tmdb_id, type) is the composite unique
                                           // key — tmdb_id alone ties (movie/TV share
                                           // ids), so page order must span both.
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`Cannot read titles: ${error.message}`)
    for (const r of rows ?? []) known.add(key(r.type as string, r.tmdb_id as string))
    if ((rows?.length ?? 0) < PAGE) break
  }
  const startCount = known.size

  // ── 1. Seed new titles (variety sweep), bounded by budget + target ────────
  let seeded = 0
  const remainingToTarget = Math.max(0, TARGET_CATALOG - startCount)
  const seedBudget = Math.min(SEED_COUNT, remainingToTarget)

  // Where tonight's sweep resumes in SLICES. The caller owns this cursor
  // because only the caller survives between runs; it advances it by the
  // slices we report as SCANNED. Anchoring to startCount (the old behaviour,
  // still the fallback for a hand-run) advances the window by titles SEEDED
  // while it scans DISCOVER_CAP slices, which is a different unit — the window
  // slides back onto itself as yield falls.
  const cursorBase = DISCOVER_OFFSET >= 0 ? DISCOVER_OFFSET : startCount
  let slicesScanned = 0
  // How far the cursor may safely advance. NOT the same as slicesScanned: a
  // slice whose discoverVaried threw (TMDB 429/5xx/401 — the only errors it
  // raises; a 404 comes back as an empty list) was never actually read, and
  // telling the caller to resume past it hands it a hole. So the cursor stops
  // at the FIRST such slice and the sweep re-reads from there next run.
  //
  // The cost of that is bounded and cheap: the slices after the failure are
  // re-scanned, which costs one discover call each and no OMDB spend, since
  // `known` dedupes everything they return. The cost of NOT doing it is a
  // 400-slice hole that does not come round again for a full sweep cycle
  // (slice_space / DISCOVER_CAP ≈ 5 nights at the current settings).
  //
  // A permanently-failing single slice cannot pin the sweep here, because
  // discoverVaried only throws on transport/auth errors, which are global and
  // transient — a slice with bad params comes back 200-with-no-results, not an
  // error. A night where TMDB is down end-to-end leaves the cursor exactly
  // where it started, which is what you want: nothing was seeded either.
  let slicesAdvanced = 0
  let sweepInterrupted = false
  // Spend + failure accounting. `seeded` counts SUCCESSES, but the binding
  // ceiling (OMDB, 1,000 lookups/day) is spent per ATTEMPT: fetchAndCacheTitle
  // calls OMDB before the upsert that can throw, so every failed attempt costs
  // a lookup that `seeded` never sees. Nothing else meters this — the exit code
  // is swallowed by design and the summary is all the operator gets — so the
  // counts have to reach the summary or a cap overrun is silent.
  let seedAttempts = 0
  let seedFailures = 0
  let discoverFailures = 0
  // How many candidates discover actually handed back. Without it a night where
  // every page came back FULL of titles we already hold is indistinguishable in
  // the summary from one where the pages came back nearly EMPTY — same seeded,
  // same slices_scanned, same seed_attempts — and those two want opposite moves
  // on DISCOVER_PAGES (deeper vs. no point going deeper).
  let candidatesSeen = 0
  // The attempt ceiling this run must not cross, and whether it did.
  // seedBudget + 10%, in integer arithmetic — `Math.ceil(900 * 1.1)` is 991,
  // not 990, and this number is a spend ceiling, so it does not get to round up.
  // 0 disables the cap outright (Infinity), matching the 0-means-off knobs
  // above; only an unset -1 derives the default.
  const attemptCap =
    SEED_ATTEMPT_CAP < 0
      ? seedBudget + Math.ceil(seedBudget / 10)
      : SEED_ATTEMPT_CAP === 0
        ? Infinity
        : SEED_ATTEMPT_CAP
  let spendCapped = false

  if (seedBudget > 0) {
    outer: for (let attempt = 0; attempt < DISCOVER_CAP; attempt++) {
      const { type, genreId, yearGte, yearLte, page, voteCountGte } =
        SLICES[(cursorBase + attempt) % SLICES.length]
      // Count the slice as scanned as soon as we commit to it: a `break outer`
      // below happens mid-slice, and the caller must not be told to resume ON
      // this slice (it would re-scan) nor past it.
      slicesScanned = attempt + 1

      // Space the discover calls themselves. The 260 ms courtesy below sits on
      // the SEED path, which a dupe-heavy night barely touches: a slice whose
      // 20 candidates are all already in `known` falls straight through the
      // `continue` with no delay, so the next discover fires immediately.
      // Measured on the saturated night the sweep converges to (every
      // candidate a dupe): DISCOVER_CAP=400 discover requests, all of them
      // back-to-back — 400 in a 10 s window against the 40 req/10 s this file
      // cites three times. Even at 19-of-20 dupes it peaks at 78. One sleep
      // here costs DISCOVER_CAP × 260 ms ≈ 104 s of a ~90 min run.
      if (attempt > 0) await sleep(260)

      let candidates
      try {
        candidates = await discoverVaried(type, { genreId, yearGte, yearLte, page, voteCountGte })
        if (!sweepInterrupted) {
          slicesAdvanced = attempt + 1
          // Recovery marker for the caller's no-summary path (killed at the
          // wall / OOM, so the summary's discover_next never prints). SAME
          // semantics as discover_next below — cursorBase + slices safely
          // advanced — so resuming there never skips an unread slice. Every
          // 10 keeps the log cheap; recovery granularity is ≤10 slices.
          if (slicesAdvanced % 10 === 0)
            console.log(`[grow] cursor=${cursorBase + slicesAdvanced}`)
        }
      } catch (e) {
        sweepInterrupted = true // the cursor stops here; see slicesAdvanced above
        discoverFailures++
        console.error(`[grow] discover slice failed (${type} g${genreId} ${yearGte}s p${page}):`, e)
        await sleep(1000) // back off before the next slice — a TMDB 429/5xx
                          // shouldn't trigger DISCOVER_CAP rapid-fire retries
        continue
      }

      candidatesSeen += candidates.length
      for (const item of candidates) {
        if (known.has(key(item.type, item.tmdb_id))) continue
        seedAttempts++
        try {
          const ok = await fetchAndCacheTitle(item.tmdb_id, item.type)
          if (ok) {
            known.add(key(item.type, item.tmdb_id))
            seeded++
            if (seeded >= seedBudget) break outer
          } else {
            seedFailures++ // TMDB 404 — no OMDB call, but the title is not in
                           // `known` either, so the next sweep retries it
          }
        } catch (e) {
          seedFailures++
          console.error(`[grow] cache ${item.type} ${item.tmdb_id} failed:`, e)
        }
        // Stop on SPEND, not just on yield. Every iteration above has already
        // cost an OMDB lookup whether or not it produced a title, and OMDB is
        // the one ceiling no gate on either side can see.
        if (seedAttempts >= attemptCap) {
          spendCapped = true
          console.error(`[grow] seed attempt cap ${attemptCap} reached (seeded ${seeded}/${seedBudget}) — stopping to stay under the OMDB daily ceiling`)
          break outer
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

  // ── 3. Backfill posters for the least-recently-checked slice of the NULL
  // backlog. Identical rotation to §3b below, and for the same reason: this
  // step used to select `poster_path IS NULL` in unspecified order and write
  // back only when TMDB HAD a poster, so a title with genuinely no poster was
  // never recorded as checked — it stayed in the NULL set, re-filled the limit
  // window every night, and the rows behind it were never reached. Measured:
  // `posters_backfilled` was 0 on 19 of 19 committed nightly summaries.
  // Stamping last_poster_check on every successful lookup (poster found or not)
  // advances the cursor, so dead ends rotate to the back instead of being
  // re-fetched forever. Requires migration 0016 (last_poster_check); without it
  // the ordered query returns no rows and this step is a harmless no-op.
  //
  // The batch size is POSTER_BACKFILL, not SEED_COUNT + 50: the poster backlog
  // has nothing to do with the seed budget, and an enrich-only re-run
  // (SEED_COUNT=0) used to silently shrink this batch to 50.
  let postersBackfilled = 0
  if (POSTER_BACKFILL > 0) {
    const { data: noPoster } = await db
      .from('titles')
      .select('tmdb_id, type')
      .is('poster_path', null)
      .order('last_poster_check', { ascending: true, nullsFirst: true })
      .limit(POSTER_BACKFILL)
    const checkedAt = new Date().toISOString()
    for (const row of noPoster ?? []) {
      try {
        const detail =
          row.type === 'movie'
            ? await getMovie(row.tmdb_id as string)
            : await getTV(row.tmdb_id as string)
        // Stamp the check (plus the poster if one was found) so the rotation
        // cursor advances. A thrown fetch leaves the row unstamped → retried
        // next run.
        const patch: { last_poster_check: string; poster_path?: string } = {
          last_poster_check: checkedAt,
        }
        if (detail?.poster_path) {
          patch.poster_path = detail.poster_path
          postersBackfilled++
        }
        await db.from('titles').update(patch)
          .eq('tmdb_id', row.tmdb_id).eq('type', row.type)  // composite key (0008)
      } catch {
        /* best-effort — transient TMDB/DB error; row stays unstamped for retry */
      }
      await sleep(150)
    }
  }

  // ── 3b. Backfill trailers for the least-recently-checked slice of the NULL
  // backlog. New titles capture trailer_key at seed time (fetchAndCacheTitle);
  // this heals the pre-trailer backlog and catches trailers published after a
  // title's release. Ordering by last_trailer_check (NULLS FIRST = never
  // checked) is a fair round-robin that keeps sweeping even after catalog growth
  // stops — every NULL row is eventually re-checked, oldest first. We stamp
  // last_trailer_check on every row we successfully look up (trailer found or
  // not) so the cursor always advances; titles with genuinely no trailer rotate
  // to the back instead of being re-fetched every night. Cheap TMDB calls —
  // append_to_response=videos rides the existing detail fetch. Requires
  // migration 0012 (last_trailer_check); without it the ordered query returns
  // no rows and this step is a harmless no-op.
  // TRAILER_RECHECK_DAYS puts a floor on the cadence: the rotation is fair but
  // it is not paced, so a genuinely trailerless title is re-fetched every time
  // the backlog cycles. Never-checked rows (last_trailer_check IS NULL) stay
  // eligible always — hence `.or()` and not a bare `.lt()`, which would drop
  // them (SQL `NULL < x` is NULL, not true). Nothing due → no rows → no-op,
  // the same shape this step already has when migration 0012 is absent.
  let trailersBackfilled = 0
  if (TRAILER_BACKFILL > 0) {
    const recheckBefore = new Date(
      Date.now() - TRAILER_RECHECK_DAYS * 86_400_000,
    ).toISOString()
    let q = db
      .from('titles')
      .select('tmdb_id, type')
      .is('trailer_key', null)
    if (TRAILER_RECHECK_DAYS > 0) {
      q = q.or(`last_trailer_check.is.null,last_trailer_check.lt.${recheckBefore}`)
    }
    const { data: rows } = await q
      .order('last_trailer_check', { ascending: true, nullsFirst: true })
      .limit(TRAILER_BACKFILL)
    const checkedAt = new Date().toISOString()
    for (const row of rows ?? []) {
      try {
        const detail =
          row.type === 'movie'
            ? await getMovie(row.tmdb_id as string)
            : await getTV(row.tmdb_id as string)
        // Stamp the check (plus the key if one was found) so the rotation cursor
        // advances. A thrown fetch leaves the row unstamped → retried next run.
        const patch: { last_trailer_check: string; trailer_key?: string } = {
          last_trailer_check: checkedAt,
        }
        if (detail?.trailer_key) {
          patch.trailer_key = detail.trailer_key
          trailersBackfilled++
        }
        await db.from('titles').update(patch)
          .eq('tmdb_id', row.tmdb_id).eq('type', row.type) // composite key (0008)
      } catch {
        /* best-effort — transient TMDB/DB error; row stays unstamped for retry */
      }
      await sleep(260) // TMDB courtesy (40 req / 10s)
    }
  }

  // ── 4. Final counts + JSON summary (LAST line) ────────────────────────────
  const [{ count: total }, { count: enrichedTotal }] = await Promise.all([
    db.from('titles').select('tmdb_id', { count: 'exact', head: true }),
    db.from('titles').select('tmdb_id', { count: 'exact', head: true }).not('enriched_at', 'is', null),
  ])

  // KEY ORDER IS LOAD-BEARING, not cosmetic. The exit code is swallowed by
  // design, so this JSON is all the operator ever sees — and the digest prints
  // only `head -c 400` of it (dream-runner.sh:343). run.sh then prepends
  // ok/seed_yield/growth_stalling, which costs ~106 of those bytes on exactly
  // the nights that matter (a stalling night is the one you need to read).
  // Measured on 2026-08-14's real shape: at the previous key order the summary
  // was 482 bytes and `seed_failures` (byte 402) and `discover_failures` (byte
  // 422) fell OUTSIDE the window — the two keys that exist so an OMDB-costing
  // failure run and a TMDB outage stay legible were invisible in the only
  // place anyone looks. So: diagnosis first (what went wrong, what it cost),
  // then the sweep state, then the totals that can be recomputed from
  // Supabase at any time. Adding a key means checking the window again —
  // reports/2026-08-15/wtw/tests/test_digest_window.py measures it.
  const summary = {
    ok: true,
    started_titles: startCount,
    seeded,
    // Spend + failure legibility. seed_attempts is the OMDB-costing number
    // (successes AND failures); discover_failures separates "TMDB is down"
    // from "the pool is exhausted", which seeded=0 alone cannot.
    seed_attempts: seedAttempts,
    seed_failures: seedFailures,
    discover_failures: discoverFailures,
    // Present ONLY when the attempt ceiling actually stopped the run, so it
    // costs nothing in the digest's 400-byte window on a normal night and is
    // impossible to miss on the night it matters.
    ...(spendCapped ? { spend_capped: attemptCap } : {}),
    // Sweep accounting for the caller's persisted cursor. `discover_next` is
    // offset + slices SCANNED, never offset + DISCOVER_CAP: the loop breaks
    // early once the budget is met, and advancing by the cap would skip every
    // slice it never reached. null when we did no seeding at all, so the
    // caller leaves its cursor where it is.
    slices_scanned: slicesScanned,
    // candidates_seen is the denominator the other two need: it is the only
    // number that separates "the pages are empty" (candidates_seen well under
    // slices_scanned×20 → the pool at this depth is exhausted) from "the pages
    // are full of titles we already hold" (candidates_seen ≈ slices_scanned×20
    // with seed_attempts low → deeper pages would help). See the DISCOVER_PAGES
    // note above; without it that knob can only be re-derived from an assumed
    // page size, which is what put it where it is.
    candidates_seen: candidatesSeen,
    discover_next: slicesAdvanced > 0 ? cursorBase + slicesAdvanced : null,
    growth_complete: (total ?? 0) >= TARGET_CATALOG,
    total_titles: total ?? null,
    target: TARGET_CATALOG,
    enriched,
    enrich_failures: enrichFailures,
    // Past here is beyond the 400-byte digest window on a stalling night, by
    // choice: all four are either constant, recomputable from Supabase, or
    // (the two backfills) have read 0/0 on every committed summary to date.
    enriched_total: enrichedTotal ?? null,
    posters_backfilled: postersBackfilled,
    trailers_backfilled: trailersBackfilled,
    slice_space: SLICES.length,
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
