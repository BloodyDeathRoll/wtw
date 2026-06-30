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

const TTL_SECONDS = 6 * 60 * 60   // 6 hours

export function recCacheKey(userId: string, tasteVersion: number): string {
  return `rec:${userId}:${tasteVersion}`
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
  tasteVersion: number
): Promise<RecommendationResult[] | null> {
  const redis = getRedis()
  return redis.get<RecommendationResult[]>(recCacheKey(userId, tasteVersion))
}

export async function cacheRecommendations(
  userId: string,
  tasteVersion: number,
  results: RecommendationResult[]
): Promise<void> {
  const redis = getRedis()
  await redis.set(recCacheKey(userId, tasteVersion), results, { ex: TTL_SECONDS })
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
