/**
 * budget-check — the free-tier budgets, once a day (docs/plan/PLAN.md §6).
 *
 *   node --env-file=.env.local --import tsx scripts/budget-check.mts           # a short summary
 *   node --env-file=.env.local --import tsx scripts/budget-check.mts --json    # one line, for the Dream digest
 *
 * Read-only and costs nothing: the database's own size (pg, SUPABASE_DB_URL),
 * and the marks the app already leaves in Redis when a free budget runs out —
 * Groq models the Why writer marked out (`why_model_out:*`) and Jev's failure
 * log (`jev:failures`). Warns at 80% of Supabase's 500 MB (src/lib/budget.ts).
 * Mistral's nightly budget is in grow-catalog's summary; TMDB has no quota.
 */
import pg from 'pg'
import { budgetReport, type BudgetSnapshot } from '@/lib/budget'

const JSON_OUT = process.argv.includes('--json')

async function database(): Promise<Pick<BudgetSnapshot, 'dbBytes' | 'dbTables'>> {
  const url = process.env.SUPABASE_DB_URL
  if (!url) return { dbBytes: null }
  const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    const size = await c.query(`select pg_database_size(current_database())::bigint b`)
    const tables = await c.query(`select c.relname n, pg_total_relation_size(c.oid)::bigint b
      from pg_class c join pg_namespace s on s.oid = c.relnamespace
      where s.nspname = 'public' and c.relkind = 'r' order by 2 desc limit 4`)
    return { dbBytes: Number(size.rows[0].b), dbTables: tables.rows.map(r => ({ name: r.n, bytes: Number(r.b) })) }
  } finally {
    await c.end()
  }
}

async function redis(): Promise<Pick<BudgetSnapshot, 'modelsOut' | 'jevFailures24h' | 'redisKeys'>> {
  const url = process.env.UPSTASH_REDIS_REST_URL, token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return { modelsOut: [], jevFailures24h: 0, redisKeys: null }
  const cmd = async (c: (string | number)[]) => {
    const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(c) })
    return (await res.json() as { result: unknown }).result
  }
  const modelsOut: BudgetSnapshot['modelsOut'] = []
  let cursor = '0'
  do {
    const [next, keys] = await cmd(['SCAN', cursor, 'MATCH', 'why_model_out:*', 'COUNT', 500]) as [string, string[]]
    cursor = next
    for (const k of keys) modelsOut.push({ model: k.slice('why_model_out:'.length), ttlSeconds: Number(await cmd(['TTL', k])) })
  } while (cursor !== '0')
  const since = Date.now() - 24 * 60 * 60 * 1000
  const failures = (await cmd(['LRANGE', 'jev:failures', 0, 49]) as string[] | null) ?? []
  const jevFailures24h = failures.filter(f => {
    try { return Date.parse((JSON.parse(f) as { at?: string }).at ?? '') >= since } catch { return false }
  }).length
  return { modelsOut, jevFailures24h, redisKeys: Number(await cmd(['DBSIZE'])) }
}

const snapshot: BudgetSnapshot = { ...(await database()), ...(await redis()) }
const report = budgetReport(snapshot)

if (JSON_OUT) {
  console.log(JSON.stringify({ ok: report.ok, db_mb: report.db?.mb ?? null, db_share: report.db?.share ?? null, models_out: snapshot.modelsOut.map(m => m.model), jev_failures_24h: snapshot.jevFailures24h, redis_keys: snapshot.redisKeys, warnings: report.warnings }))
} else {
  const mb = (b: number) => `${Math.round(b / 1024 / 1024)} MB`
  console.log(`Budgets ${report.ok ? 'OK' : 'need a look'}`)
  if (report.db) console.log(`  database: ${report.db.mb} MB of 500 MB (${Math.round(report.db.share * 100)}%)${snapshot.dbTables ? ` · ${snapshot.dbTables.map(t => `${t.name} ${mb(t.bytes)}`).join(', ')}` : ''}`)
  console.log(`  Groq (Why writer): ${snapshot.modelsOut.length ? snapshot.modelsOut.map(m => `${m.model} out ${Math.ceil(m.ttlSeconds / 60)} min`).join(', ') : 'no model out of budget'}`)
  console.log(`  Jev: ${snapshot.jevFailures24h} failure(s) in 24 h · Redis: ${snapshot.redisKeys ?? '?'} keys`)
  for (const w of report.warnings) console.log(`  ⚠ ${w}`)
}
