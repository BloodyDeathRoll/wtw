/**
 * The v2 pool's stats, saved with every batch (v3 M1).
 *
 * Under formula v2 a match isn't absolute: each part is a z-score within the
 * candidate pool, and the match is Φ(s / sd(s)) over that pool. So one title,
 * scored on its own (score-one.ts), only gets the match the feed would give it
 * when it's placed against the same pool. Each batch saves that pool's stats
 * here, per user and list; the latest one wins.
 *
 * A week, because a saved title's card page should still match today's feed,
 * and a user who hasn't opened the feed in days still has the last pool.
 * Best-effort both ways: a failed save just means the next one-title score
 * builds the pool itself.
 */
import 'server-only'

import { getRedis } from '@/lib/redis'
import type { ContentType } from '@/lib/content-type'
import type { ScoredTitle } from '../types'
import { v2PoolStats, type V2Parts, type V2PoolStats } from './formula-v2'

const key = (userId: string, list: ContentType) => `v2_pool:${userId}:${list}`
export const POOL_STATS_TTL_SECONDS = 7 * 24 * 60 * 60

export interface SavedPoolStats {
  stats: V2PoolStats
  /** The fingerprint the pool was scored with. */
  taste_version: number
  list: ContentType
  at: string
}

/** The parts formula v2 combined for a scored title (step2-composite-score.ts). */
export function v2PartsOf(s: ScoredTitle): V2Parts {
  return { creators: s.crew_affinity_score, crowd: s.external_rating_score, model: s.formula_v2?.model_score ?? null }
}

/** The stats of a scored v2 pool; null when it isn't one (v1, or empty). */
export function poolStatsOf(scored: ScoredTitle[]): V2PoolStats | null {
  if (!scored.length || !scored.every(s => s.formula_v2)) return null
  return v2PoolStats(scored.map(v2PartsOf))
}

export async function savePoolStats(
  userId: string, list: ContentType, stats: V2PoolStats, tasteVersion: number,
): Promise<void> {
  try {
    const value: SavedPoolStats = { stats, taste_version: tasteVersion, list, at: new Date().toISOString() }
    await getRedis().set(key(userId, list), value, { ex: POOL_STATS_TTL_SECONDS })
  } catch (err) {
    console.warn('[pool-stats] not saved (non-fatal):', err instanceof Error ? err.message : err)
  }
}

/** The first saved pool among `lists`, in that order; null when none (or Redis is down). */
export async function readPoolStats(userId: string, lists: ContentType[]): Promise<SavedPoolStats | null> {
  try {
    const found = await getRedis().mget<(SavedPoolStats | null)[]>(...lists.map(l => key(userId, l)))
    return found.find((v): v is SavedPoolStats => !!v?.stats && v.stats.n > 0) ?? null
  } catch (err) {
    console.warn('[pool-stats] read failed:', err instanceof Error ? err.message : err)
    return null
  }
}
