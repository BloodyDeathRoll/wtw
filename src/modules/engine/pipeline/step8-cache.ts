/**
 * Step 8 — Redis Cache
 *
 * Caches the final RecommendationResult[] in Upstash Redis.
 * Key: rec2:{user_id}:{taste_version}:{type}  TTL: 6 hours
 *
 * The taste_version in the key means cache entries are automatically
 * superseded when Assignment 3 increments taste_version after a DNA update.
 * Old versions expire on their own after 6h — no explicit invalidation needed.
 *
 * Co-watch results are cached separately, keyed by room code AND both members.
 */

import { getRedis } from '@/lib/redis'
import type { RecommendationResult, CowatchResult } from '@/types/dna'
import type { ContentType } from '@/lib/content-type'

const TTL_SECONDS = 6 * 60 * 60   // 6 hours

/**
 * Movies and series are generated SEPARATELY (2026-08-29), so each gets its
 * own cache entry. They used to share one: the batch was built type-blind and
 * only filtered on the way out, which left a movie-dominant fingerprint with
 * 46 movies / 4 series in a batch of 50 — one servable series after the
 * judged/removed filters, and "Find more" produced another 90% movies.
 */
export function recCacheKey(
  userId: string,
  tasteVersion: number,
  contentType: ContentType = 'all',
): string {
  // `rec2:` since 2026-11-06: batches cached before then could carry an AI
  // paragraph with invented facts in `explanation`. The new prefix leaves
  // them unread (they expire within 6h); each user rebuilds once.
  return `rec2:${userId}:${tasteVersion}:${contentType}`
}

/**
 * Both user ids are part of the key, in caller order. A room code is 4 digits
 * and is recycled as rooms expire (minutes to 2h) while this entry lives 6h,
 * and taste versions are small integers — so code + versions alone let a later,
 * unrelated pair be served this pair's results, prose about their taste
 * included. Caller order matters too: the result is built from user A's side
 * (score_user_a, reason_payload), so the guest must not be handed the host's.
 */
export function cowatchCacheKey(
  roomCode: string,
  userIdA: string,
  tasteVersionA: number,
  userIdB: string,
  tasteVersionB: number
): string {
  return `cowatch:${roomCode}:${userIdA}:${tasteVersionA}:${userIdB}:${tasteVersionB}`
}

export async function getCachedRecommendations(
  userId: string,
  tasteVersion: number,
  contentType: ContentType = 'all',
): Promise<RecommendationResult[] | null> {
  const redis = getRedis()
  return redis.get<RecommendationResult[]>(recCacheKey(userId, tasteVersion, contentType))
}

export async function cacheRecommendations(
  userId: string,
  tasteVersion: number,
  results: RecommendationResult[],
  contentType: ContentType = 'all',
): Promise<void> {
  const redis = getRedis()
  await redis.set(recCacheKey(userId, tasteVersion, contentType), results, { ex: TTL_SECONDS })
}

/**
 * The "Why it's a match" sheet's text per title (step7-card-reason.ts,
 * `sheetReason`), one hash per user, written when a batch is built —
 * precomputed batches included, so an adopted batch already has it. Not
 * versioned: the text is facts about the title and the people you rated, and
 * the next build overwrites it. Replaced the AI paragraph (`rec_sheet:*`,
 * 2026-11-06); those keys are never read and expire on their own.
 */
export function whyTextKey(userId: string): string {
  return `rec_why:${userId}`
}

export async function cacheWhyTexts(userId: string, texts: Map<string, string>): Promise<void> {
  if (texts.size === 0) return
  const redis = getRedis()
  const key = whyTextKey(userId)
  await redis.hset(key, Object.fromEntries(texts))
  await redis.expire(key, TTL_SECONDS)
}

/** One title's sheet text, or null if no batch with it was built in the last 6h. */
export async function getWhyText(userId: string, key: string): Promise<string | null> {
  const redis = getRedis()
  return redis.hget<string>(whyTextKey(userId), key)
}

export async function getCachedCowatch(
  roomCode: string,
  userIdA: string,
  tasteVersionA: number,
  userIdB: string,
  tasteVersionB: number
): Promise<CowatchResult[] | null> {
  const redis = getRedis()
  return redis.get<CowatchResult[]>(
    cowatchCacheKey(roomCode, userIdA, tasteVersionA, userIdB, tasteVersionB)
  )
}

export async function cacheCowatchResults(
  roomCode: string,
  userIdA: string,
  tasteVersionA: number,
  userIdB: string,
  tasteVersionB: number,
  results: CowatchResult[]
): Promise<void> {
  const redis = getRedis()
  await redis.set(
    cowatchCacheKey(roomCode, userIdA, tasteVersionA, userIdB, tasteVersionB),
    results,
    { ex: TTL_SECONDS }
  )
}
