/**
 * Delete my account (v3 Y3, docs/plan/v3/YOU.md DEC-3): erase the account and everything WTW holds about the person.
 *
 * Every table that holds a person's data references public.users on delete cascade, and public.users references
 * auth.users on delete cascade (checked live 2026-11-19), so deleting the login removes them all at once:
 *   users (the DNA) · recommendation_feedback · served_titles · removed_titles · watchlist_entries · play_state ·
 *   play_events · conversations (and their messages) · dna_snapshots · fingerprint_embeddings · feedback ·
 *   cowatch_rooms (as host or guest).
 * Outside the database, the Redis keys that hold the user id (rec caches, pool stats, rate limits, …) are deleted
 * first; if that fails, nothing else happens and the person can try again (the sheet's red line). A request landing
 * between the sweep and the login delete could write a key again, so they're swept once more afterwards
 * (best-effort: by then the login is gone, and so is any way to use them). A table added later with a user column must reference users on delete cascade too:
 * scripts/check-account-delete.mts finds every such table in the live schema and checks a deleted test account
 * leaves nothing behind.
 *
 * Emails already in the team's feedback inbox stay there (YOU.md DEC-5); the feedback rows go.
 */
import 'server-only'

import { createServiceClient } from '@/lib/supabase/service'
import { getRedis } from '@/lib/redis'
import { userRedisKeys } from '@/lib/reset-taste'

/** The user-owned tables, each cascading from users (the PR lists them; the live check verifies them). */
export const USER_TABLES = [
  'users', 'recommendation_feedback', 'served_titles', 'removed_titles', 'watchlist_entries', 'play_state',
  'play_events', 'conversations', 'dna_snapshots', 'fingerprint_embeddings', 'feedback', 'cowatch_rooms',
] as const

async function sweepRedis(userId: string): Promise<number> {
  const keys = await userRedisKeys(userId)
  for (let i = 0; i < keys.length; i += 100) await getRedis().del(...keys.slice(i, i + 100))
  return keys.length
}

export async function deleteAccount(userId: string): Promise<{ redisKeys: number }> {
  // Redis first, and it must succeed: a failure here throws before anything is deleted, so the person can retry.
  let redisKeys = await sweepRedis(userId).catch(err => {
    throw new Error(`clear redis: ${err instanceof Error ? err.message : err}`)
  })
  const { error } = await createServiceClient().auth.admin.deleteUser(userId)
  if (error) throw new Error(`delete login: ${error.message}`)
  // A key written by a request that landed in between.
  redisKeys += await sweepRedis(userId).catch(err => {
    console.warn('[delete-account] second redis sweep failed (non-fatal):', err instanceof Error ? err.message : err)
    return 0
  })
  return { redisKeys }
}
