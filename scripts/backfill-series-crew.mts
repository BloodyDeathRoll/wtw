/**
 * backfill-series-crew — give the catalogue's series their directors and writers (docs/rating-check-mobland.md,
 * cause 2): their crew was read from TMDB `credits`, which for a series lists no Director (806 of a sample of 1,000
 * had none; the full run on 2026-11-19 found 6,412 of 8,229, and left 940).
 * New series now come in through `aggregate_credits` (src/lib/tmdb.ts normaliseAggregateCredits); this fixes the
 * ones already in `titles`.
 *
 *   npm run backfill-series-crew                       # dry run: what would change (no writes), all series
 *   npm run backfill-series-crew -- --limit 200        # dry run on the first 200 (most-voted first)
 *   npm run backfill-series-crew -- --apply            # write
 *
 * Per series: one TMDB call (`/tv/{id}/aggregate_credits`). Merged into the row's crew, never replacing it:
 * directors and cinematographers from the aggregate where the row has none (else the row's, then the aggregate's,
 * no doubles), writers = the row's (creators came from `created_by` already) then the aggregate's, cast kept.
 * Only rows that change are written. TMDB is asked at ~10 requests a second (its limit is ~40), 4 at a time.
 */
import { createServiceClient } from '@/lib/supabase/service'
import { getSeriesCrew, type TMDBCrewSnapshot } from '@/lib/tmdb'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const LIMIT = (() => {
  const i = args.indexOf('--limit')
  if (i < 0) return Infinity
  const n = Number(args[i + 1])
  if (!Number.isInteger(n) || n <= 0) throw new Error('--limit needs a positive whole number, e.g. --limit 200')
  return n
})()
const CONCURRENCY = 4, GAP_MS = 400
const db = createServiceClient()

type Person = { tmdb_person_id: string; name: string }
const merge = (have: Person[] = [], add: Person[] = [], cap: number) => {
  const out = [...have], seen = new Set(have.map(p => p.tmdb_person_id))
  for (const p of add) { if (out.length >= cap) break; if (!seen.has(p.tmdb_person_id)) { out.push(p); seen.add(p.tmdb_person_id) } }
  return out
}

// Every series, most-voted first, paged.
const rows: { id: number; tmdb_id: string; title: string; crew: TMDBCrewSnapshot | null }[] = []
for (let from = 0; rows.length < LIMIT; from += 1000) {
  const { data, error } = await db.from('titles').select('id, tmdb_id, title, crew').eq('type', 'tv')
    .order('tmdb_vote_count', { ascending: false, nullsFirst: false }).range(from, from + 999)
  if (error) throw new Error(error.message)
  rows.push(...((data ?? []) as typeof rows))
  if (!data || data.length < 1000) break
}
const todo = rows.slice(0, LIMIT)
console.log(`${APPLY ? 'APPLY' : 'dry run'} · ${todo.length} series · no director on record today: ${todo.filter(r => !r.crew?.directors?.length).length}`)

let done = 0, changed = 0, gainedDirector = 0, gainedWriter = 0, tmdbMissing = 0, fetchErrors = 0, failed = 0
const examples: string[] = []
async function one(r: (typeof todo)[number]) {
  // null: TMDB has no such series (404). A throw: a failed call (429, 5xx, network), counted apart.
  let agg: TMDBCrewSnapshot | null
  try { agg = await getSeriesCrew(r.tmdb_id) } catch (err) {
    fetchErrors++
    console.error(`  ${r.title}: ${err instanceof Error ? err.message : err}`)
    return
  }
  if (!agg) { tmdbMissing++; return }
  const have = r.crew ?? { directors: [], writers: [], cinematographers: [], cast: [] }
  const next: TMDBCrewSnapshot = {
    directors: merge(have.directors, agg.directors, 3),
    writers: merge(have.writers, agg.writers, 6),
    cinematographers: merge(have.cinematographers, agg.cinematographers, 2),
    cast: have.cast?.length ? have.cast : agg.cast,
  }
  const addD = next.directors.length - (have.directors?.length ?? 0), addW = next.writers.length - (have.writers?.length ?? 0)
  if (addD <= 0 && addW <= 0 && next.cinematographers.length === (have.cinematographers?.length ?? 0) && next.cast.length === (have.cast?.length ?? 0)) return
  changed++
  if (addD > 0 && !have.directors?.length) gainedDirector++
  if (addW > 0) gainedWriter++
  if (examples.length < 6 && addD > 0) examples.push(`${r.title}: + ${next.directors.slice(-addD).map(d => d.name).join(', ')}`)
  if (APPLY) {
    const { error } = await db.from('titles').update({ crew: next }).eq('id', r.id)
    if (error) { failed++; console.error(`  ${r.title}: ${error.message}`) }
  }
}

for (let i = 0; i < todo.length; i += CONCURRENCY) {
  await Promise.all(todo.slice(i, i + CONCURRENCY).map(one))
  done = Math.min(todo.length, i + CONCURRENCY)
  if (done % 400 < CONCURRENCY) console.log(`  … ${done} / ${todo.length}`)
  await new Promise(r => setTimeout(r, GAP_MS))
}
console.log(`${APPLY ? 'written' : 'would change'}: ${changed} of ${todo.length} · gain a director (had none): ${gainedDirector} · gain writers: ${gainedWriter} · TMDB had nothing: ${tmdbMissing} · TMDB calls failed: ${fetchErrors}${APPLY ? ` · failed writes: ${failed}` : ''}`)
console.log('e.g.', examples.join(' | '))
