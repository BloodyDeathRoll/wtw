/**
 * Upstash Redis client — singleton, server-side only.
 */
import { Redis } from '@upstash/redis'

let _redis: Redis | null = null

export function getRedis(): Redis {
  if (!_redis) {
    const url = process.env.UPSTASH_REDIS_REST_URL
    const token = process.env.UPSTASH_REDIS_REST_REST_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN
    if (!url || !token) throw new Error('Upstash Redis env vars are not set')
    _redis = new Redis({ url, token })
  }
  return _redis
}
