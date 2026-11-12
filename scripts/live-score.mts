/**
 * live-score — the deck's metric on real use (docs/plan/PLAN.md §6, soft launch).
 *
 *   node --env-file=.env.local --conditions=react-server --import tsx scripts/live-score.mts
 *   … --days 7         reactions from the last N days (default 7)
 *   … --min 10         users need this many scored, rated cards per formula (default 10)
 *   … --json           one JSON object, for the Dream digest
 *
 * Per user and per formula (v1 / v2): the concordance between the score each
 * feed card was served with (served_titles.last_score, migration 0032) and the
 * reaction it then got (recommendation_feedback). 50 is a coin flip. The
 * scoring is src/modules/engine/live-score.ts.
 *
 * Read-only. Users are shown as a short hash of their id, never an email; the
 * repo is public, so paste the output into INTEGRATION.md only in aggregate.
 */
import { createHash } from 'node:crypto'
import { createServiceClient } from '@/lib/supabase/service'
import { userLiveScores, type Level, type ReactionRow, type ServedRow, type UserLiveScore } from '@/modules/engine/live-score'

const args = process.argv.slice(2)
const num = (name: string, def: number) => {
  const i = args.indexOf(name)
  const v = i < 0 ? def : Number(args[i + 1])
  if (!Number.isFinite(v) || v < 0) throw new Error(`${name} needs a number`)
  return v
}
const DAYS = num('--days', 7)
const MIN = num('--min', 10)
const JSON_OUT = args.includes('--json')
const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000).toISOString()

const db = createServiceClient()
const PAGE = 1000
const LEVELS = new Set(['loved', 'liked', 'disliked'])

async function pageAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < PAGE) return out
  }
}

const feedback = await pageAll<{ user_id: string; recommendation_id: string; rating: string; created_at: string }>((a, b) =>
  db.from('recommendation_feedback').select('user_id, recommendation_id, rating, created_at')
    .gte('created_at', since).order('created_at').range(a, b))

const reactionsBy = new Map<string, ReactionRow[]>()
for (const f of feedback) {
  if (!LEVELS.has(f.rating) || !/^(movie|tv):\d+$/.test(f.recommendation_id)) continue
  const list = reactionsBy.get(f.user_id) ?? []
  list.push({ key: f.recommendation_id, level: f.rating as Level, at: f.created_at })
  reactionsBy.set(f.user_id, list)
}

const label = (id: string) => `u-${createHash('sha256').update(id).digest('hex').slice(0, 6)}`
const rows: { user: string; scores: UserLiveScore[] }[] = []
for (const [userId, reactions] of reactionsBy) {
  const served = await pageAll<{ tmdb_id: string; media_type: string; last_score: number | null; last_formula: string | null; first_served_at: string }>((a, b) =>
    db.from('served_titles').select('tmdb_id, media_type, last_score, last_formula, first_served_at')
      .eq('user_id', userId).not('last_score', 'is', null).range(a, b))
  const scores = userLiveScores(
    served.map((s): ServedRow => ({ key: `${s.media_type}:${s.tmdb_id}`, score: s.last_score, formula: s.last_formula, first_served_at: s.first_served_at })),
    reactions,
    MIN,
  )
  if (scores.length) rows.push({ user: label(userId), scores })
}

/** Mean of the per-user concordances, weighted by each user's scored reactions. */
const pooled = (formula: 'v1' | 'v2') => {
  const s = rows.flatMap(r => r.scores.filter(x => x.formula === formula))
  const n = s.reduce((t, x) => t + x.n, 0)
  if (!n) return null
  const w = (k: 'concordance' | 'ld') => s.filter(x => !Number.isNaN(x[k])).reduce((t, x) => t + x[k] * x.n, 0) / s.filter(x => !Number.isNaN(x[k])).reduce((t, x) => t + x.n, 0)
  return { users: s.length, reactions: n, concordance: w('concordance'), ld: w('ld') }
}

const reactionsInWindow = [...reactionsBy.values()].reduce((t, r) => t + r.length, 0)
if (JSON_OUT) {
  console.log(JSON.stringify({ days: DAYS, min: MIN, since, reactions: reactionsInWindow, users: rows, pooled: { v1: pooled('v1'), v2: pooled('v2') } }))
} else {
  const f = (x: number) => (Number.isNaN(x) ? '—' : x.toFixed(0))
  console.log(`Live score — reactions since ${since.slice(0, 10)} (${DAYS} days): ${reactionsInWindow} from ${reactionsBy.size} users; users with ≥ ${MIN} scored reactions per formula: ${rows.length}`)
  for (const r of rows) {
    for (const s of r.scores) console.log(`  ${r.user}  ${s.formula}  n ${s.n} (${s.loved}/${s.liked}/${s.disliked})  concordance ${f(s.concordance)}  L/D ${f(s.ld)}`)
  }
  for (const k of ['v1', 'v2'] as const) {
    const p = pooled(k)
    console.log(p ? `  ${k} pooled: ${p.users} users, ${p.reactions} reactions, concordance ${f(p.concordance)}, L/D ${f(p.ld)}` : `  ${k}: no scored reactions yet`)
  }
}
