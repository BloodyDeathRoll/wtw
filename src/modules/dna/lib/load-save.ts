import { createServiceClient } from '@/lib/supabase/service'
import { getRedis } from '@/lib/redis'
import type { DNASchema } from '@/types/dna'
import { createBlankDNA } from '../blank-dna'

export type TitleCrewMember = { tmdb_person_id: string; name: string }
export type TitleCrew = {
  directors:        TitleCrewMember[]
  writers:          TitleCrewMember[]
  cinematographers: TitleCrewMember[]
  cast:             (TitleCrewMember & { order: number })[]
}
export type TitleRow = {
  tmdb_id:            string
  crew:               TitleCrew
  pacing_tag:         string | null
  tone_tags:          string[]
  narrative_metadata: Record<string, unknown>
}

// Redis TTL for cached DNA reads — short enough that a write followed
// by a read sees fresh data even if invalidation is somehow missed.
const CACHE_TTL_SECONDS = 60
const cacheKey = (user_id: string) => `dna:${user_id}`

export async function loadDNA(user_id: string): Promise<DNASchema> {
  const cached = await getCachedDNA(user_id)
  if (cached) return cached

  const db = createServiceClient()
  const { data, error } = await db
    .from('users')
    .select('dna')
    .eq('id', user_id)
    .single<{ dna: DNASchema | null }>()

  if (error) throw new Error(`loadDNA: ${error.message}`)
  const dna = data?.dna ?? createBlankDNA(user_id)

  await setCachedDNA(user_id, dna)
  return dna
}

export async function saveDNA(user_id: string, dna: DNASchema): Promise<void> {
  const db = createServiceClient()
  const { error } = await db
    .from('users')
    .update({ dna, updated_at: new Date().toISOString() })
    .eq('id', user_id)

  if (error) throw new Error(`saveDNA: ${error.message}`)

  await invalidateDNACache(user_id)
}

/**
 * Invalidates the Redis cache for a user's DNA.
 * Called automatically by saveDNA — exported in case a caller writes
 * `users.dna` directly (e.g. rollback) and needs to bust the cache itself.
 */
export async function invalidateDNACache(user_id: string): Promise<void> {
  try {
    const redis = getRedis()
    await redis.del(cacheKey(user_id))
  } catch (err) {
    // Cache invalidation failure is non-fatal — Supabase is the source of truth
    console.warn('[load-save] Cache invalidation failed (non-fatal):', err)
  }
}

async function getCachedDNA(user_id: string): Promise<DNASchema | null> {
  try {
    const redis = getRedis()
    const raw = await redis.get<DNASchema>(cacheKey(user_id))
    return raw ?? null
  } catch (err) {
    console.warn('[load-save] Redis get failed (non-fatal):', err)
    return null
  }
}

async function setCachedDNA(user_id: string, dna: DNASchema): Promise<void> {
  try {
    const redis = getRedis()
    await redis.set(cacheKey(user_id), dna, { ex: CACHE_TTL_SECONDS })
  } catch (err) {
    console.warn('[load-save] Redis set failed (non-fatal):', err)
  }
}

export async function fetchTitleCrew(tmdb_ids: string[]): Promise<Map<string, TitleRow>> {
  if (tmdb_ids.length === 0) return new Map()

  const db = createServiceClient()
  const { data, error } = await db
    .from('titles')
    .select('tmdb_id, title, type, crew, pacing_tag, tone_tags, narrative_metadata')
    .in('tmdb_id', tmdb_ids)

  if (error) throw new Error(`fetchTitleCrew: ${error.message}`)

  const map = new Map<string, TitleRow>()
  for (const row of data ?? []) {
    map.set(row.tmdb_id, row as TitleRow)
  }
  return map
}

// Increment taste_version and stamp last_updated — call before every saveDNA
export function bumpVersion(dna: DNASchema): void {
  dna.metadata.taste_version += 1
  dna.metadata.last_updated   = new Date().toISOString()
}
