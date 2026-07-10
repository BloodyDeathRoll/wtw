/**
 * Upstash Redis client — singleton, server-side only.
 */
import { Redis } from '@upstash/redis'

let _redis: Redis | null = null

/**
 * Strip paste artifacts that break Upstash auth: surrounding quotes and
 * stray whitespace/newlines. Both produce WRONGPASS even when the token
 * itself is correct — seen live in production after a dashboard paste.
 */
function clean(v: string | undefined): string | undefined {
  const t = v?.trim().replace(/^["']|["']$/g, '').trim()
  return t || undefined
}

export function getRedis(): Redis {
  if (!_redis) {
    // Exactly ONE name each — a typo'd fallback (UPSTASH_REDIS_REST_REST_TOKEN)
    // used to take precedence here and silently shadowed the real token when a
    // stale var by that name existed in the deploy environment.
    const url = clean(process.env.UPSTASH_REDIS_REST_URL)
    const token = clean(process.env.UPSTASH_REDIS_REST_TOKEN)
    if (!url || !token) throw new Error('Upstash Redis env vars are not set')
    _redis = new Redis({ url, token })
  }
  return _redis
}
