/**
 * Wipe a user's taste back to a first run. Shared by "Start my taste over" on the You tab
 * (POST /api/account/start-over, Eran 2026-11-15) and the test-account script (scripts/reset-account.mts, P2-U7).
 *
 * In this order (a failed run can simply be re-run: the DNA is written last, so it still holds what `keepLists`
 * needs):
 *   - a snapshot of the current DNA is stored — no snapshot, no reset (the app prunes dna_snapshots to the last
 *     5, so it is a rollback point for a while);
 *   - with `keepGames`, the games' progress row is rewritten in place to a fresh state that keeps only the scores
 *     (each game's level and plays, best scores, chains already served); its version goes up, so a tab still open
 *     on the old state can't save over it (409);
 *   - deleted: play_state (unless `keepGames`), play_events, served_titles, the conversations (messages go with
 *     them), recommendation_feedback and the fingerprint embedding — the app reads chat messages and feedback to
 *     tell a new user from an existing one;
 *   - removed_titles and watchlist_entries too, unless `keepLists` (then the watchlist's saved markers are kept in
 *     the new recommendation history, so saved titles stay off the feed);
 *   - the DNA becomes blank (blank-dna.ts), but taste_version keeps counting up, so no cache keyed by an old
 *     version is ever served again;
 *   - every Redis key that holds the user id (the DNA and rec caches, the greeting, the precompute lock, …).
 * The auth account is kept.
 */
import { createServiceClient } from '@/lib/supabase/service'
import { getRedis } from '@/lib/redis'
import { isSavedMarker } from '@/lib/title-key'
import { createBlankDNA } from '@/modules/dna/blank-dna'
import { invalidateDNACache } from '@/modules/dna/lib/load-save'
import { freshState, type PlayState } from '@/app/play/lib/brain'
import { readUserDNA } from '@/modules/engine/dna-read'

export interface ResetOptions {
  /** Keep the Watchlist and the titles taken off the feed. */
  keepLists: boolean
  /** Keep the games' scores (levels, plays, best scores, chains served). */
  keepGames: boolean
}

/** Tables keyed by user_id that a first run must not see. */
export function resetTables({ keepLists, keepGames }: ResetOptions): string[] {
  return [
    ...(keepGames ? [] : ['play_state']),
    'play_events', 'served_titles', 'recommendation_feedback', 'fingerprint_embeddings', 'conversations',
    ...(keepLists ? [] : ['removed_titles', 'watchlist_entries']),
  ]
}

/** Every Redis key that holds the user id. */
export async function userRedisKeys(userId: string): Promise<string[]> {
  const redis = getRedis()
  const keys: string[] = []
  let cursor: string | number = 0
  do {
    const [next, batch]: [string | number, string[]] = await redis.scan(cursor, { match: `*${userId}*`, count: 1000 })
    keys.push(...batch)
    cursor = next
  } while (String(cursor) !== '0')
  return keys
}

/** A fresh games state that keeps only the scores from `old`. */
export function scoresOnly(old: Partial<PlayState> | null | undefined): PlayState {
  const S = freshState()
  if (!old) return S
  if (old.games) S.games = old.games
  if (old.gameBest) S.gameBest = old.gameBest
  if (typeof old.gamePlays === 'number') S.gamePlays = old.gamePlays
  if (old.served) S.served = old.served
  return S
}

export interface ResetResult { tables: number; redisKeys: number; tasteVersion: number }

export async function resetTaste(userId: string, opts: ResetOptions): Promise<ResetResult> {
  const db = createServiceClient()
  const { row, dna } = await readUserDNA(userId)   // #457: whole only when it changed; throws on a failed read
  if (!row) throw new Error('no such user')

  // A DNA with no signals (a re-run after the DNA write, or a fresh account) has nothing to roll back to.
  if (dna && dna.signals.length > 0) {
    // Written here, not through storeSnapshot (which logs and returns on failure): no snapshot, no reset.
    // The app usually snapshotted this version already (unique per user + version), so overwrite it
    // with exactly the DNA read now. The app's next storeSnapshot prunes back to the last 5.
    const { error: snapErr } = await db.from('dna_snapshots')
      .upsert({ user_id: userId, taste_version: dna.metadata.taste_version, snapshot: dna }, { onConflict: 'user_id,taste_version' })
    if (snapErr) throw new Error(`snapshot not stored (${snapErr.message}) — nothing was reset`)
  }

  if (opts.keepGames) {
    const { data: play, error: playErr } = await db.from('play_state').select('state, version').eq('user_id', userId)
      .maybeSingle<{ state: Partial<PlayState> | null; version: number }>()
    if (playErr) throw new Error(`play_state: ${playErr.message} (the DNA is untouched; re-run to finish)`)
    if (play) {
      const { error: e } = await db.from('play_state').update({ state: scoresOnly(play.state), version: play.version + 1 }).eq('user_id', userId)
      if (e) throw new Error(`play_state: ${e.message} (the DNA is untouched; re-run to finish)`)
    }
  }

  const tables = resetTables(opts)
  for (const t of tables) {
    const { error: e } = await db.from(t).delete().eq('user_id', userId)
    if (e) throw new Error(`${t}: ${e.message} (the DNA is untouched; re-run to finish)`)
  }

  const blank = createBlankDNA(userId)
  blank.metadata.taste_version = (dna?.metadata.taste_version ?? 0) + 1
  if (opts.keepLists && dna) blank.learning_loop.recommendation_history = dna.learning_loop.recommendation_history.filter(isSavedMarker)
  const { error: saveErr } = await db.from('users').update({ dna: blank, updated_at: new Date().toISOString() }).eq('id', userId)
  if (saveErr) throw new Error(`users: ${saveErr.message}`)

  // Scanned after the writes, so a key written while the rows were going is caught too.
  let keys: string[]
  try {
    await invalidateDNACache(userId)
    keys = await userRedisKeys(userId)
    if (keys.length) await getRedis().del(...keys)
  } catch (e) {
    throw new Error(`the database is reset, but Redis cleanup failed (${(e as Error).message}) — re-run to clear Redis`)
  }
  return { tables: tables.length, redisKeys: keys.length, tasteVersion: blank.metadata.taste_version }
}
