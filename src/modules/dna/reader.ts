import type { DNASchema } from '@/types/dna'
import { createClient } from '@/lib/supabase/server'
import { buildEmptyDNA } from './init'

/**
 * Redis TTL for cached DNA reads (seconds).
 * Short enough that a write followed by a read sees fresh data.
 * Assignment 2 (Recommendation Engine) reads this frequently during a session.
 */
const CACHE_TTL_SECONDS = 60

/**
 * Reads the current DNASchema for a user from Supabase.
 * Results are cached in Upstash Redis for CACHE_TTL_SECONDS.
 *
 * If no DNA exists yet (new user), returns a freshly built empty schema
 * without writing it — the first writeDNA call will persist it.
 *
 * Used by:
 *   - Assignment 2 (Recommendation Engine) to read the full fingerprint
 *   - Assignment 3 writer internally before merging updates
 */
export async function readDNA(userId: string): Promise<DNASchema> {
  // Try Redis cache first
  const cached = await getCached(userId)
  if (cached) return cached

  // Fall back to Supabase
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('users')
    .select('dna')
    .eq('id', userId)
    .single()

  if (error && error.code !== 'PGRST116') {
    // PGRST116 = row not found — that's fine for new users
    console.error('[reader] Supabase read error:', error)
    throw new Error(`Failed to read DNA for user ${userId}: ${error.message}`)
  }

  const dna: DNASchema = data?.dna ?? buildEmptyDNA(userId)

  // Warm the cache
  await setCached(userId, dna)

  return dna
}

/**
 * Invalidates the Redis cache for a user.
 * Called by the writer immediately after a successful Supabase write
 * so the next readDNA call fetches fresh data.
 */
export async function invalidateDNACache(userId: string): Promise<void> {
  try {
    const redis = await getRedisClient()
    if (!redis) return
    await redis.del(cacheKey(userId))
  } catch (err) {
    // Cache invalidation failure is non-fatal — Supabase is the source of truth
    console.warn('[reader] Cache invalidation failed (non-fatal):', err)
  }
}

// ─── Redis helpers ────────────────────────────────────────────────────────────

function cacheKey(userId: string): string {
  return `dna:${userId}`
}

async function getCached(userId: string): Promise<DNASchema | null> {
  try {
    const redis = await getRedisClient()
    if (!redis) return null
    const raw = await redis.get<DNASchema>(cacheKey(userId))
    return raw ?? null
  } catch (err) {
    console.warn('[reader] Redis get failed (non-fatal):', err)
    return null
  }
}

async function setCached(userId: string, dna: DNASchema): Promise<void> {
  try {
    const redis = await getRedisClient()
    if (!redis) return
    await redis.set(cacheKey(userId), dna, { ex: CACHE_TTL_SECONDS })
  } catch (err) {
    console.warn('[reader] Redis set failed (non-fatal):', err)
  }
}

/**
 * Lazily initialises the Upstash Redis client.
 * Returns null if env vars are not configured (dev/test without Redis).
 */
async function getRedisClient() {
  const url   = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN

  if (!url || !token) return null

  // Dynamic import keeps this a soft dependency —
  // the module works without Redis, just without caching.
  const { Redis } = await import('@upstash/redis')
  return new Redis({ url, token })
}
