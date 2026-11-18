/**
 * score-one-check — v3 M1's "done when", read-only (docs/plan/v3/PLAN.md §4 M1).
 *
 *   node --env-file=.env.local --conditions=react-server --import tsx scripts/score-one-check.mts --user <uuid> [--n 20]
 *
 * Builds the user's Both pool the way a batch does (steps 1–2), takes its top
 * N, then scores each title alone the way /api/recommendations/score does
 * (score-one.ts: the title on its own, placed against the pool's stats) and
 * compares the match %. Also times each one-title score. No writes: no DNA,
 * no cache, no Redis. Prints no title-level data with user ids.
 */
import { createServiceClient } from '@/lib/supabase/service'
import { getCandidates } from '@/modules/engine/pipeline/step1-candidate-gen'
import { scoreCandidates } from '@/modules/engine/pipeline/step2-composite-score'
import { scoreAgainstPool } from '@/modules/engine/scoring/formula-v2'
import { poolStatsOf, v2PartsOf } from '@/modules/engine/scoring/pool-stats'
import { displayMatch } from '@/modules/engine/match-display'
import { loadTitleRows } from '@/modules/engine/why/score-titles'
import type { DNASchema } from '@/types/dna'

process.env.FORMULA_V2 = 'true'
process.env.JEV_ENABLED = 'false'
const args = process.argv.slice(2)
const opt = (n: string, d?: string) => { const i = args.indexOf(n); return i < 0 ? d : args[i + 1] }
const USER = opt('--user'); const N = Number(opt('--n', '20'))
if (!USER) throw new Error('--user <uuid> required')
const log = console.log; console.log = (...a: unknown[]) => { if (!String(a[0]).startsWith('[')) log(...a) }

const { data } = await createServiceClient().from('users').select('dna').eq('id', USER).single()
const dna = data!.dna as DNASchema
const t0 = performance.now()
const pool = await scoreCandidates(await getCandidates(structuredClone(dna), undefined, 'all'), structuredClone(dna))
const stats = poolStatsOf(pool)!
log(`pool: ${pool.length} titles, built in ${(performance.now() - t0).toFixed(0)} ms`)

const top = [...pool].sort((a, b) => b.composite_score - a.composite_score).slice(0, N)
const pct = (c: number) => Math.round(displayMatch(c, true) * 100)
const diffs: number[] = [], ms: number[] = []
for (const s of top) {
  const t = performance.now()
  const [row] = await loadTitleRows([{ type: s.title.type, tmdb_id: s.title.tmdb_id }])
  const [alone] = await scoreCandidates([row], structuredClone(dna))   // a fresh DNA object: trains the taste model, as a request does
  const one = scoreAgainstPool(v2PartsOf(alone), stats)
  ms.push(performance.now() - t)
  diffs.push(Math.abs(pct(one.composite) - pct(s.composite_score)))
}
const q = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))]
log(`top ${top.length}: match % differs by at most ${Math.max(...diffs)} point(s) (${diffs.filter(d => d === 0).length} identical)`)
log(`one-title score: p50 ${q(ms, 0.5).toFixed(0)} ms · p95 ${q(ms, 0.95).toFixed(0)} ms · max ${Math.max(...ms).toFixed(0)} ms (local, to production DB)`)
