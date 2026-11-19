/**
 * Delete my account (v3 Y3, docs/plan/v3/YOU.md DEC-3): erase the account and everything WTW holds about the person.
 *
 * Every table that holds a person's data references public.users on delete cascade, and public.users references
 * auth.users on delete cascade (checked live 2026-11-19), so deleting the login removes them all at once:
 *   users (the DNA) · recommendation_feedback · served_titles · removed_titles · watchlist_entries · play_state ·
 *   play_events · conversations (and their messages) · dna_snapshots · fingerprint_embeddings · feedback ·
 *   cowatch_rooms (as host or guest).
 * Outside the database, the Redis keys that hold the user id (rec caches, pool stats, rate limits, …) are deleted
 * first. A table added later with a user column must reference users on delete cascade too:
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
  'play_events', 'conversations', 'dna_snapshots', 'fingerprint_embeddings', 'feedback',
] as const

export async function deleteAccount(userId: string): Promise<{ redisKeys: number }> {
  // Redis first: if the login delete then fails, only caches are gone and the person can try again.
  let redisKeys = 0
  try {
    const keys = await userRedisKeys(userId)
    for (let i = 0; i < keys.length; i += 100) await getRedis().del(...keys.slice(i, i + 100))
    redisKeys = keys.length
  } catch (err) {
    console.warn('[delete-account] redis keys not cleared (non-fatal):', err instanceof Error ? err.message : err)
  }
  const { error } = await createServiceClient().auth.admin.deleteUser(userId)
  if (error) throw new Error(`delete login: ${error.message}`)
  return { redisKeys }
}
