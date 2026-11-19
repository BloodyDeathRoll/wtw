/**
 * search-check — v3 retest R3 (docs/plan/v3/PLAN.md §5, for gate P2-G): does Search find titles from the second
 * letter and through a one-word typo, and how fast?
 *
 *   npm run search-check                      # R3's queries, the way /api/search answers with SEARCH_V3 on
 *   npm run search-check -- --user <uuid>     # also times the match ring (M1's one-title score) on catalogue hits
 *   npm run search-check -- --json            # one JSON object
 *   npm run search-check -- --cold            # rank as if the vote quantiles weren't loaded yet (first search of the day)
 *
 * Runs the route's own pieces (src/lib/search-catalogue.ts + searchTitles), not the HTTP route, which needs a
 * signed-in user. Times are from this machine to the production database and TMDB, so a round trip from here is
 * in them; the route logs its own catalogue time in production. Read-only, except that --user may save that
 * user's pool stats to Redis when none are saved (score-one.ts does that on every first call).
 */
import { createServiceClient } from '@/lib/supabase/service'
import { searchTitles, type SearchHit } from '@/lib/tmdb'
import { catalogueCandidates, mergeSearch, voteQuantiles } from '@/lib/search-catalogue'
import { scoreOneTitle } from '@/modules/engine/score-one'

const args = process.argv.slice(2)
const opt = (n: string) => { const i = args.indexOf(n); return i < 0 ? undefined : args[i + 1] }
const USER = opt('--user')
const JSON_OUT = args.includes('--json')
const COLD = args.includes('--cold')
process.env.FORMULA_V2 ??= 'true'

/** R3's queries (PLAN.md §5) and what each should find. `null`: nothing in particular, just look. */
const CASES: { q: string; expect: string | null; why: string }[] = [
  { q: 'sl', expect: 'Slow Horses', why: 'two letters' },
  { q: 'se', expect: null, why: 'two letters' },
  { q: 'godfahter', expect: 'The Godfather', why: 'a one-word typo' },
  { q: 'shtisle', expect: 'Shtisel', why: 'a typo of a title outside the catalogue' },
  // 10 titles, in and out of the catalogue (the check says which)
  { q: 'slow horses', expect: 'Slow Horses', why: 'whole name' },
  { q: 'breaking bad', expect: 'Breaking Bad', why: 'whole name' },
  { q: 'severance', expect: 'Severance', why: 'whole name' },
  { q: 'interstellar', expect: 'Interstellar', why: 'whole name' },
  { q: 'the office', expect: 'The Office', why: 'whole name' },
  { q: 'fauda', expect: 'Fauda', why: 'Israeli series' },
  { q: 'shtisel', expect: 'Shtisel', why: 'Israeli series' },
  { q: 'the bear', expect: 'The Bear', why: 'whole name' },
  { q: 'past lives', expect: 'Past Lives', why: 'whole name' },
  { q: 'nobody wants this', expect: 'Nobody Wants This', why: 'whole name' },
]

const db = createServiceClient()
async function inCatalogue(hits: SearchHit[]): Promise<Set<string>> {
  const titles = hits.filter((h): h is Exclude<SearchHit, { type: 'person' }> => h.type !== 'person')
  const out = new Set<string>()
  for (const type of ['movie', 'tv'] as const) {
    const ids = titles.filter(h => h.type === type).map(h => h.tmdb_id)
    if (!ids.length) continue
    const { data } = await db.from('titles').select('tmdb_id').eq('type', type).in('tmdb_id', ids)
    for (const r of data ?? []) out.add(`${type}:${r.tmdb_id}`)
  }
  return out
}

const name = (h: SearchHit) => (h.type === 'person' ? `@${h.name}` : h.title)
const quantiles = COLD ? {} : await voteQuantiles()
const rows = []
for (const c of CASES) {
  const t0 = performance.now()
  let catalogueMs = 0
  const [tmdb, cat] = await Promise.allSettled([
    searchTitles(c.q, 12, { people: true, withVotes: true }),
    catalogueCandidates(c.q).finally(() => { catalogueMs = performance.now() - t0 }),
  ])
  const hits = mergeSearch(
    c.q,
    tmdb.status === 'fulfilled' ? tmdb.value : [],
    cat.status === 'fulfilled' ? cat.value : [],
    quantiles,
  )
  const totalMs = performance.now() - t0
  const ours = await inCatalogue(hits)
  const at = c.expect ? hits.findIndex(h => h.type !== 'person' && h.title.toLowerCase() === c.expect!.toLowerCase()) : -1

  // The ring (Q5): M1 on each catalogue hit, timed.
  const ringMs: number[] = []
  if (USER) {
    for (const h of hits) {
      if (h.type === 'person' || !ours.has(`${h.type}:${h.tmdb_id}`)) continue
      const t = performance.now()
      await scoreOneTitle(USER, { type: h.type, tmdb_id: h.tmdb_id })
      ringMs.push(performance.now() - t)
    }
  }
  rows.push({
    q: c.q, why: c.why, expect: c.expect,
    found: c.expect ? (at >= 0 ? at + 1 : null) : undefined,
    results: hits.map(h => ({ name: name(h), ours: h.type !== 'person' && ours.has(`${h.type}:${h.tmdb_id}`) })),
    catalogue_ms: Math.round(catalogueMs), total_ms: Math.round(totalMs),
    tmdb_failed: tmdb.status === 'rejected', catalogue_failed: cat.status === 'rejected',
    ring_ms_max: ringMs.length ? Math.round(Math.max(...ringMs)) : undefined,
  })
}

if (JSON_OUT) {
  console.log(JSON.stringify({ at: new Date().toISOString(), quantiles: Object.keys(quantiles), rows }))
} else {
  console.log(`R3 · Search (SEARCH_V3), ${new Date().toISOString().slice(0, 16)} UTC · times from this machine${quantiles.movie ? '' : ' · ranked without vote quantiles (first run fills them)'}`)
  for (const r of rows) {
    const verdict = r.expect == null ? '·' : r.found ? `✓ #${r.found}` : '✗ not found'
    const ring = r.ring_ms_max != null ? ` · ring ≤ ${r.ring_ms_max} ms` : ''
    console.log(`\n${r.q.padEnd(18)} ${verdict.padEnd(12)} catalogue ${r.catalogue_ms} ms · total ${r.total_ms} ms${ring}  (${r.why})`)
    console.log(`   ${r.results.map(x => `${x.name}${x.ours ? '' : ' °'}`).join(' | ') || '—'}`)
    if (r.tmdb_failed || r.catalogue_failed) console.log(`   ⚠ ${r.tmdb_failed ? 'TMDB' : 'catalogue'} failed`)
  }
  const exp = rows.filter(r => r.expect)
  console.log(`\n° = not in our catalogue (no ring, no breakdown: plan DEC-5). Found ${exp.filter(r => r.found).length} of ${exp.length} expected.`)
}
