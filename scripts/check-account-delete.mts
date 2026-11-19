/**
 * check-account-delete — v3 Y3's "done when" (docs/plan/v3/PLAN.md §4 Y3), on a truly new account:
 * every user table holds zero rows for it after Delete my account, and the same email can sign up fresh.
 *
 *   node --env-file=.env.local --conditions=react-server --import tsx scripts/check-account-delete.mts
 *   (needs SUPABASE_DB_URL in .env.local, as budget-check and the load test do)
 *
 * It creates a throwaway login (wtw-delete-check+<time>@example.com) with the admin API, gives it a row in every
 * table that references a user (found from the live schema, so a table added later is covered), plus a Redis key,
 * then runs the same deleteAccount the route runs, and checks. Then it signs the same email up again and deletes it.
 * Writes only that throwaway account's rows, and leaves nothing behind. Prints no other user's data.
 */
import pg from 'pg'
import { createServiceClient } from '@/lib/supabase/service'
import { getRedis } from '@/lib/redis'
import { deleteAccount, USER_TABLES } from '@/lib/delete-account'

const db = createServiceClient()
const sql = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await sql.connect()
const ok = (b: boolean) => (b ? '✓' : '✗')
let failed = false

// Every (table, column) that references a user, from the live schema.
const links = (await sql.query(`
  select cl.relname tbl, a.attname col, con.confdeltype del
  from pg_constraint con
  join pg_class cl on cl.oid = con.conrelid join pg_namespace n on n.oid = cl.relnamespace
  join pg_class fcl on fcl.oid = con.confrelid join pg_namespace fn on fn.oid = fcl.relnamespace
  join pg_attribute a on a.attrelid = con.conrelid and a.attnum = any(con.conkey)
  where con.contype = 'f' and n.nspname = 'public' and fcl.relname = 'users' and fn.nspname in ('public', 'auth')`)).rows as { tbl: string; col: string; del: string }[]
const notCascading = links.filter(l => l.del !== 'c')
console.log(`user-linked columns: ${links.length} (${links.map(l => `${l.tbl}.${l.col}`).join(', ')})`)
console.log(`${ok(!notCascading.length)} all delete with the user${notCascading.length ? `: NOT ${notCascading.map(l => l.tbl).join(', ')}` : ''}`)
if (notCascading.length) failed = true
// The documented list (delete-account.ts) against the live schema: a new user table should be added there too.
const live = new Set(links.map(l => l.tbl)), listed = new Set<string>(USER_TABLES)
const unlisted = [...live].filter(t => !listed.has(t)), stale = [...listed].filter(t => !live.has(t))
console.log(`${ok(!unlisted.length && !stale.length)} USER_TABLES matches the schema${unlisted.length ? `; not listed: ${unlisted.join(', ')}` : ''}${stale.length ? `; listed but gone: ${stale.join(', ')}` : ''}`)

async function newUser(email: string): Promise<string> {
  const { data, error } = await db.auth.admin.createUser({ email, email_confirm: true })
  if (error || !data.user) throw new Error(`create user: ${error?.message}`)
  for (let i = 0; i < 20; i++) {                       // the users row comes from a trigger
    const { data: row } = await db.from('users').select('id').eq('id', data.user.id).maybeSingle()
    if (row) return data.user.id
    await new Promise(r => setTimeout(r, 250))
  }
  throw new Error('users row never appeared')
}

const email = `wtw-delete-check+${Date.now()}@example.com`
const uid = await newUser(email)
console.log(`throwaway account created (${uid.slice(0, 8)}…)`)

// A row in each table, as the app would write them.
const seed: [string, Record<string, unknown>][] = [
  ['recommendation_feedback', { user_id: uid, recommendation_id: 'movie:603', rating: 'loved' }],
  ['served_titles', { user_id: uid, tmdb_id: '603', media_type: 'movie' }],
  ['removed_titles', { user_id: uid, tmdb_id: '604', media_type: 'movie' }],
  ['watchlist_entries', { user_id: uid, rec_id: 'movie:605', rec: { id: 'movie:605', title: 'check' } }],
  ['play_state', { user_id: uid, state: {} }],
  ['play_events', { user_id: uid, kind: 'check' }],
  ['dna_snapshots', { user_id: uid, taste_version: 1, snapshot: {} }],
  ['fingerprint_embeddings', { user_id: uid, taste_version: 1 }],
  ['feedback', { user_id: uid, body: 'delete check' }],
]
for (const [t, row] of seed) {
  const { error } = await db.from(t).insert(row)
  if (error) console.log(`  (couldn't seed ${t}: ${error.message})`)
}
const { data: conv } = await db.from('conversations').insert({ user_id: uid }).select('id').single()
if (conv) await db.from('messages').insert({ conversation_id: conv.id, role: 'user', content: 'delete check' })
for (let i = 0; i < 5; i++) {                          // a co-watch room with a free 4-digit code
  const code = String(1000 + Math.floor(Math.random() * 9000))
  const { error } = await db.from('cowatch_rooms').insert({ code, host_id: uid })
  if (!error) break
}
await getRedis().set(`delete-check:${uid}`, '1', { ex: 600 })

const count = async (): Promise<Record<string, number>> => {
  const out: Record<string, number> = {}
  for (const l of links) out[`${l.tbl}.${l.col}`] = Number((await sql.query(`select count(*) n from public."${l.tbl}" where "${l.col}" = $1`, [uid])).rows[0].n)
  out['messages (via conversations)'] = conv ? Number((await sql.query(`select count(*) n from public.messages where conversation_id = $1`, [conv.id])).rows[0].n) : 0
  return out
}
const before = await count()
console.log(`before: ${Object.entries(before).filter(([, n]) => n > 0).length} of ${Object.keys(before).length} hold rows (${Object.entries(before).filter(([, n]) => n === 0).map(([k]) => k).join(', ') || 'all'}${Object.values(before).some(n => n === 0) ? ' empty' : ''})`)

const r = await deleteAccount(uid)
const after = await count()
const left = Object.entries(after).filter(([, n]) => n > 0)
const { data: still } = await db.auth.admin.getUserById(uid)
const redisLeft = await getRedis().get(`delete-check:${uid}`)
console.log(`${ok(!left.length)} after delete, every user table is empty${left.length ? `: LEFT ${left.map(([k, n]) => `${k}=${n}`).join(', ')}` : ''}`)
console.log(`${ok(!still?.user)} the login is gone`)
console.log(`${ok(redisLeft == null)} the Redis keys are gone (${r.redisKeys} deleted)`)
if (left.length || still?.user || redisLeft != null) failed = true

// The same email can sign up fresh.
const again = await newUser(email).catch(e => { console.log(`✗ the same email can't sign up again: ${e.message}`); failed = true; return null })
if (again) {
  const { data: fresh } = await db.from('users').select('dna').eq('id', again).single()
  console.log(`${ok(fresh?.dna == null)} the same email signs up fresh (a new account, no fingerprint yet)`)
  await deleteAccount(again)
}
await sql.end()
console.log(failed ? '\nFAILED' : '\nPASSED: nothing left behind')
process.exit(failed ? 1 : 0)
