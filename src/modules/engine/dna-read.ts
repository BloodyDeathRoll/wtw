/**
 * The engine's DNA read (#457): the whole DNA only when it changed.
 *
 * `users.dna` was read whole 6,751 times since 5 Nov, ≈ 2.7 GB of the cycle's 2.83 GB of Supabase
 * egress (#438): 0.17–0.88 MB of JSON per read, mostly unchanged since the last one. Every update
 * of the row moves `users.updated_at` (the `users_updated_at` trigger, migration 0001), whichever
 * code writes it, so the stamp says for certain whether a kept copy is still the DNA:
 *
 *   1. read `updated_at` (a few bytes);
 *   2. this server's memory has a copy with that stamp → use it (Fluid Compute reuses instances);
 *   3. Redis has one with that stamp → use it (another instance, or after a restart);
 *   4. otherwise read the whole DNA once, with its stamp, and keep it in both.
 *
 * Never stale, whatever wrote the row and whether or not it cleared a cache. Callers get their own
 * copy: some mutate the DNA they're given.
 */
import 'server-only'

import { createServiceClient } from '@/lib/supabase/service'
import { getRedis } from '@/lib/redis'
import type { DNASchema } from '@/types/dna'

interface Kept { u: string; dna: DNASchema }

const key = (userId: string) => `dna_kept:v1:${userId}`
/** A week in Redis: an idle user's copy goes; an active one's is re-stamped on every change. */
const REDIS_TTL_SECONDS = 7 * 24 * 60 * 60
/** Users kept in this server's memory; past this the oldest go. */
const MEMORY_MAX = 200
const memory = new Map<string, Kept>()

/** Tests only. */
export function clearKeptDNA(): void { memory.clear() }

function keep(userId: string, kept: Kept): void {
  memory.delete(userId)
  memory.set(userId, kept)
  if (memory.size > MEMORY_MAX) memory.delete(memory.keys().next().value!)
}

/**
 * The user's row and DNA, reading the DNA whole only when it changed. `row` is false when the user has
 * no row; `dna` is null with no row or a row without a DNA. Throws when the database can't be read, so a
 * caller that must tell "no DNA" from "couldn't read it" (and never write a blank DNA over a real one) can.
 */
export async function readUserDNA(userId: string): Promise<{ row: boolean; dna: DNASchema | null }> {
  const db = createServiceClient()
  const { data: stamp, error } = await db.from('users').select('updated_at').eq('id', userId).maybeSingle<{ updated_at: string }>()
  if (error) throw new Error(`readDNA: ${error.message}`)
  if (!stamp) return { row: false, dna: null }

  const mine = memory.get(userId)
  if (mine && mine.u === stamp.updated_at) return { row: true, dna: structuredClone(mine.dna) }

  let redis: ReturnType<typeof getRedis> | null = null
  try {
    redis = getRedis()
    const theirs = await redis.get<Kept>(key(userId))
    if (theirs && theirs.u === stamp.updated_at && theirs.dna) {
      keep(userId, theirs)
      return { row: true, dna: structuredClone(theirs.dna) }
    }
  } catch (err) {
    redis = null
    console.warn('[dna-read] redis read failed (reading the database):', err instanceof Error ? err.message : err)
  }

  // The DNA and its own stamp in one read: a write in between gives the newer pair, never a mix.
  const { data: row, error: readError } = await db.from('users').select('dna, updated_at').eq('id', userId)
    .maybeSingle<{ dna: DNASchema | null; updated_at: string }>()
  if (readError) throw new Error(`readDNA: ${readError.message}`)
  if (!row) return { row: false, dna: null }
  if (!row.dna) return { row: true, dna: null }
  const kept = { u: row.updated_at, dna: row.dna }
  keep(userId, kept)
  if (redis) await redis.set(key(userId), kept, { ex: REDIS_TTL_SECONDS }).catch(err => {
    console.warn('[dna-read] redis write failed (next read goes to the database):', err instanceof Error ? err.message : err)
  })
  return { row: true, dna: structuredClone(row.dna) }
}

/** The user's DNA, or null with none or when it can't be read (the engine's readers, as before #457). */
export async function readDNA(userId: string): Promise<DNASchema | null> {
  try {
    return (await readUserDNA(userId)).dna
  } catch (err) {
    console.warn('[dna-read]', err instanceof Error ? err.message : err)
    return null
  }
}
