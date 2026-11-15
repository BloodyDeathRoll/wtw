/**
 * reset-account — wipes a test account back to a first run (docs/plan/PLAN.md
 * P2-U7), so the new onboarding can be walked through again.
 *
 *   npm run reset-account -- --user <uuid>                      # dry run: what would go
 *   npm run reset-account -- --user <uuid> --apply --confirm <uuid>   # do it (the id twice, on purpose)
 *   … --apply --confirm <uuid> --keep-lists                             # keep removed titles and the watchlist
 *
 * With --apply (the steps live in src/lib/reset-taste.ts, shared with "Start my taste over" on the You tab), in
 * this order (a failed run can simply be re-run: the DNA is
 * written last, so it still holds what --keep-lists needs):
 *   - a snapshot of the current DNA is stored — no snapshot, no reset (the app
 *     prunes dna_snapshots to the last 5, so it is a rollback point for a while);
 *   - the DNA becomes blank (blank-dna.ts), but taste_version keeps counting
 *     up, so no cache keyed by an old version is ever served again;
 *   - deleted: play_state, play_events, served_titles, the conversations
 *     (messages go with them), recommendation_feedback and the fingerprint
 *     embedding — the app reads chat messages and feedback to tell a new
 *     user from an existing one;
 *   - removed_titles and watchlist_entries too, unless --keep-lists (then
 *     the watchlist's saved markers are kept in the new recommendation
 *     history, so saved titles stay off the feed);
 *   - every Redis key that holds the user id (the DNA and rec caches, the
 *     greeting, the precompute lock, …).
 * The auth account is kept. The user id is an argument; nothing here prints
 * an email. The summary names the database host, since .env.local decides it.
 */
import { createServiceClient } from '@/lib/supabase/service'
import { resetTables, resetTaste, userRedisKeys } from '@/lib/reset-taste'
import type { DNASchema } from '@/types/dna'

const args = process.argv.slice(2)
const userAt = args.indexOf('--user')
const USER_ARG = userAt >= 0 ? args[userAt + 1] : undefined
const APPLY = args.includes('--apply')
const KEEP_LISTS = args.includes('--keep-lists')
if (!USER_ARG || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(USER_ARG)) throw new Error('usage: --user <uuid> [--apply --confirm <uuid>] [--keep-lists]')
const USER: string = USER_ARG
const confirmAt = args.indexOf('--confirm')
const CONFIRM = confirmAt >= 0 ? args[confirmAt + 1] : undefined
if (APPLY && CONFIRM !== USER) throw new Error('--apply needs --confirm <the same uuid>')

const db = createServiceClient()
/** A test account goes all the way back: games included. */
const OPTS = { keepLists: KEEP_LISTS, keepGames: false }

async function main() {
  const { data: row, error } = await db.from('users').select('dna').eq('id', USER).maybeSingle<{ dna: DNASchema | null }>()
  if (error) throw new Error(error.message)
  if (!row) throw new Error('no such user')
  const dna = row.dna

  console.log(`[reset] ${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://unknown').host} · user ${USER} · DNA v${dna?.metadata.taste_version ?? '—'}, ${dna?.signals.length ?? 0} signals${KEEP_LISTS ? ' · keeping removed titles + watchlist' : ''}`)
  for (const t of resetTables(OPTS)) {
    const { count, error: e } = await db.from(t).select('*', { count: 'exact', head: true }).eq('user_id', USER)
    if (e) throw new Error(`${t}: ${e.message}`)
    console.log(`  ${t.padEnd(24)} ${count ?? 0} row(s)`)
  }
  console.log(`  redis keys               ${(await userRedisKeys(USER)).length}`)
  if (!APPLY) { console.log('\ndry run — re-run with --apply to reset'); return }

  const r = await resetTaste(USER, OPTS)
  console.log(`\nreset: DNA blank at v${r.tasteVersion} (snapshot of the old one stored if it held anything), ${r.tables} tables cleared, ${r.redisKeys} redis keys deleted`)
}

main().catch(err => { console.error(err); process.exit(1) })
