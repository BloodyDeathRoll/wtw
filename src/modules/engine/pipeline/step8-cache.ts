/**
 * Step 8 — Redis Cache
 *
 * Caches the final RecommendationResult[] in Upstash Redis.
 * Key: rec:{user_id}:{taste_version}  TTL: 6 hours
 *
 * The taste_version in the key means cache entries are automatically
 * superseded when Assignment 3 increments taste_version after a DNA update.
 * Old versions expire on their own after 6h — no explicit invalidation needed.
 *
 * Co-watch results are cached separately with a room-code key.
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
  return `rec:${userId}:${tasteVersion}:${contentType}`
}

export function cowatchCacheKey(
  roomCode: string,
  tasteVersionA: number,
  tasteVersionB: number
): string {
  return `cowatch:${roomCode}:${tasteVersionA}:${tasteVersionB}`
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

export async function getCachedCowatch(
  roomCode: string,
  tasteVersionA: number,
  tasteVersionB: number
): Promise<CowatchResult[] | null> {
  const redis = getRedis()
  return redis.get<CowatchResult[]>(cowatchCacheKey(roomCode, tasteVersionA, tasteVersionB))
}

export async function cacheCowatchResults(
  roomCode: string,
  tasteVersionA: number,
  tasteVersionB: number,
  results: CowatchResult[]
): Promise<void> {
  const redis = getRedis()
  await redis.set(
    cowatchCacheKey(roomCode, tasteVersionA, tasteVersionB),
    results,
    { ex: TTL_SECONDS }
  )
}
