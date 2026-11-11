/**
 * reset-account — wipes a test account back to a first run (docs/plan/PLAN.md
 * P2-U7), so the new onboarding can be walked through again.
 *
 *   npm run reset-account -- --user <uuid>                      # dry run: what would go
 *   npm run reset-account -- --user <uuid> --apply --confirm <uuid>   # do it (the id twice, on purpose)
 *   … --apply --confirm <uuid> --keep-lists                             # keep removed titles and the watchlist
 *
 * With --apply, in this order (a failed run can simply be re-run: the DNA is
 * written last, so it still holds what --keep-lists needs):
 *   - a snapshot of the current DNA is stored and read back — no snapshot, no
 *     reset (dna_snapshots keeps the last 5, so the oldest may go);
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
import { getRedis } from '@/lib/redis'
import { isSavedMarker } from '@/lib/title-key'
import { createBlankDNA } from '@/modules/dna/blank-dna'
import { invalidateDNACache } from '@/modules/dna/lib/load-save'
import { storeSnapshot } from '@/modules/dna/lib/snapshot'
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

/** Tables keyed by user_id that a first run must not see. */
const TABLES = ['play_state', 'play_events', 'served_titles', 'recommendation_feedback', 'fingerprint_embeddings', 'conversations', ...(KEEP_LISTS ? [] : ['removed_titles', 'watchlist_entries'])]

async function redisKeys(): Promise<string[]> {
  const redis = getRedis()
  const keys: string[] = []
  let cursor: string | number = 0
  do {
    const [next, batch]: [string | number, string[]] = await redis.scan(cursor, { match: `*${USER}*`, count: 1000 })
    keys.push(...batch)
    cursor = next
  } while (String(cursor) !== '0')
  return keys
}

async function main() {
  const { data: row, error } = await db.from('users').select('dna').eq('id', USER).maybeSingle<{ dna: DNASchema | null }>()
  if (error) throw new Error(error.message)
  if (!row) throw new Error('no such user')
  const dna = row.dna

  console.log(`[reset] ${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://unknown').host} · user ${USER} · DNA v${dna?.metadata.taste_version ?? '—'}, ${dna?.signals.length ?? 0} signals${KEEP_LISTS ? ' · keeping removed titles + watchlist' : ''}`)
  for (const t of TABLES) {
    const { count, error: e } = await db.from(t).select('*', { count: 'exact', head: true }).eq('user_id', USER)
    if (e) throw new Error(`${t}: ${e.message}`)
    console.log(`  ${t.padEnd(24)} ${count ?? 0} row(s)`)
  }
  const keys = await redisKeys()
  console.log(`  redis keys               ${keys.length}`)
  if (!APPLY) { console.log('\ndry run — re-run with --apply to reset'); return }

  // A DNA with nothing in it (a re-run after the DNA write, or a fresh account) has nothing to roll back to.
  if (dna && (dna.signals.length > 0 || dna.learning_loop.recommendation_history.length > 0)) {
    // storeSnapshot logs and returns on failure, and an older snapshot can share the version:
    // only a row written by this call counts.
    const before = new Date(Date.now() - 1000).toISOString()
    await storeSnapshot(USER, dna)
    const { count, error: readErr } = await db.from('dna_snapshots').select('id', { count: 'exact', head: true }).eq('user_id', USER).eq('taste_version', dna.metadata.taste_version).gte('created_at', before)
    if (readErr) throw new Error(`could not check the snapshot (${readErr.message}) — nothing was reset`)
    if (!count) throw new Error('snapshot not stored — nothing was reset')
  }

  for (const t of TABLES) {
    const { error: e } = await db.from(t).delete().eq('user_id', USER)
    if (e) throw new Error(`${t}: ${e.message} (the DNA is untouched; re-run to finish)`)
  }

  const blank = createBlankDNA(USER)
  blank.metadata.taste_version = (dna?.metadata.taste_version ?? 0) + 1
  if (KEEP_LISTS && dna) blank.learning_loop.recommendation_history = dna.learning_loop.recommendation_history.filter(isSavedMarker)
  const { error: saveErr } = await db.from('users').update({ dna: blank, updated_at: new Date().toISOString() }).eq('id', USER)
  if (saveErr) throw new Error(`users: ${saveErr.message}`)

  // Scanned again now, so a key written while the rows were going is caught too.
  let fresh: string[]
  try {
    await invalidateDNACache(USER)
    fresh = await redisKeys()
    if (fresh.length) await getRedis().del(...fresh)
  } catch (e) {
    throw new Error(`the database is reset, but Redis cleanup failed (${(e as Error).message}) — re-run to clear Redis`)
  }
  console.log(`\nreset: DNA blank at v${blank.metadata.taste_version} (snapshot of the old one stored if it held anything), ${TABLES.length} tables cleared, ${fresh.length} redis keys deleted`)
}

main().catch(err => { console.error(err); process.exit(1) })
