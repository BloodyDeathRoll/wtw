/**
 * reset-account — wipes a test account back to a first run (docs/plan/PLAN.md
 * P2-U7), so the new onboarding can be walked through again.
 *
 *   npm run reset-account -- --user <uuid>                      # dry run: what would go
 *   npm run reset-account -- --user <uuid> --apply              # do it
 *   npm run reset-account -- --user <uuid> --apply --keep-lists # keep removed titles and the watchlist
 *
 * With --apply:
 *   - a snapshot of the current DNA is stored first (dna_snapshots, rollback);
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
 * The auth account and earlier snapshots are kept. The user id is an
 * argument; nothing here prints an email.
 */
import { createServiceClient } from '@/lib/supabase/service'
import { getRedis } from '@/lib/redis'
import { isSavedMarker } from '@/lib/title-key'
import { createBlankDNA } from '@/modules/dna/blank-dna'
import { storeSnapshot } from '@/modules/dna/lib/snapshot'
import type { DNASchema } from '@/types/dna'

const args = process.argv.slice(2)
const userAt = args.indexOf('--user')
const USER = userAt >= 0 ? args[userAt + 1] : undefined
const APPLY = args.includes('--apply')
const KEEP_LISTS = args.includes('--keep-lists')
if (!USER || !/^[0-9a-f-]{36}$/.test(USER)) throw new Error('usage: --user <uuid> [--apply] [--keep-lists]')

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

  console.log(`[reset] user ${USER} · DNA v${dna?.metadata.taste_version ?? '—'}, ${dna?.signals.length ?? 0} signals${KEEP_LISTS ? ' · keeping removed titles + watchlist' : ''}`)
  for (const t of TABLES) {
    const { count, error: e } = await db.from(t).select('*', { count: 'exact', head: true }).eq('user_id', USER)
    if (e) throw new Error(`${t}: ${e.message}`)
    console.log(`  ${t.padEnd(24)} ${count ?? 0} row(s)`)
  }
  const keys = await redisKeys()
  console.log(`  redis keys               ${keys.length}`)
  if (!APPLY) { console.log('\ndry run — re-run with --apply to reset'); return }

  if (dna) await storeSnapshot(USER!, dna)
  const blank = createBlankDNA(USER!)
  blank.metadata.taste_version = (dna?.metadata.taste_version ?? 0) + 1
  if (KEEP_LISTS && dna) blank.learning_loop.recommendation_history = dna.learning_loop.recommendation_history.filter(isSavedMarker)
  const { error: saveErr } = await db.from('users').update({ dna: blank, updated_at: new Date().toISOString() }).eq('id', USER)
  if (saveErr) throw new Error(`users: ${saveErr.message}`)

  for (const t of TABLES) {
    const { error: e } = await db.from(t).delete().eq('user_id', USER)
    if (e) throw new Error(`${t}: ${e.message}`)
  }
  // After the DB, so a cache can't be refilled from the old rows in between.
  if (keys.length) await getRedis().del(...keys)
  console.log(`\nreset: DNA blank at v${blank.metadata.taste_version} (snapshot of the old one stored), ${TABLES.length} tables cleared, ${keys.length} redis keys deleted`)
}

main().catch(err => { console.error(err); process.exit(1) })
