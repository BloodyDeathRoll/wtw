/**
 * What a card needs from each title the viewer loved or liked, cached per title (#438).
 *
 * loadRatedByPerson read up to 400 rated titles' crews from the database on every feed build,
 * ~0.2–0.5 MB of a 2.5–3.5 MB build, though a title's crew doesn't change and a viewer's list
 * changes by one title per rating. Cached per TITLE, not per viewer, so a new rating misses only
 * the one new title, and two viewers who loved the same film share it.
 *
 * Two levels: this server's memory first (free; Fluid Compute reuses an instance across builds),
 * then Upstash (one MGET for the misses, one MSET for what the database then gives: ~3 commands
 * a build). No expiry: the facts are static. Bump VERSION if the catalogue's crews are rebuilt
 * (as the series backfill did, #395). Best-effort throughout: without Redis it reads the database.
 */
import 'server-only'

import { getRedis } from '@/lib/redis'

/**
 * A rated title's facts: its name, TMDB votes, and the people a card can name with their roles.
 * Null: not ready (not in the catalogue, or its crew not loaded yet). Never cached: it may come later.
 * Shared by reference from memory: treat as read-only.
 */
export interface RatedTitleFacts {
  t: string
  v: number
  p: [personId: string, roles: ('director' | 'writer' | 'actor')[]][]
}

const VERSION = 1
const key = (titleKey: string) => `rated_title:v${VERSION}:${titleKey}`
/** Memory bound: a catalogue is ~35k titles; past this the oldest are dropped. */
const MEMORY_MAX = 20_000
const memory = new Map<string, RatedTitleFacts>()
/** One MGET per this many keys. */
const MGET_CHUNK = 400

/** Tests only. */
export function clearRatedTitleMemory(): void { memory.clear() }

function remember(k: string, facts: RatedTitleFacts): void {
  memory.delete(k)
  memory.set(k, facts)
  if (memory.size > MEMORY_MAX) memory.delete(memory.keys().next().value!)
}

/**
 * The facts for `titleKeys` ("type:tmdb_id"), from memory, then Redis, then `load` for the rest
 * (which answers each key it was given, null for one not in the catalogue). `load` failing throws,
 * as the database read did before.
 */
export async function ratedTitleFacts(
  titleKeys: string[],
  load: (missing: string[]) => Promise<Map<string, RatedTitleFacts | null>>,
): Promise<Map<string, RatedTitleFacts | null>> {
  const out = new Map<string, RatedTitleFacts | null>()
  let missing: string[] = []
  for (const k of titleKeys) {
    if (memory.has(k)) out.set(k, memory.get(k)!)
    else missing.push(k)
  }
  if (missing.length === 0) return out

  let redis: ReturnType<typeof getRedis> | null = null
  try {
    redis = getRedis()
    const still: string[] = []
    for (let i = 0; i < missing.length; i += MGET_CHUNK) {
      const part = missing.slice(i, i + MGET_CHUNK)
      const got = await redis.mget<(RatedTitleFacts | null)[]>(...part.map(key))
      part.forEach((k, j) => {
        const g = got[j]
        if (g == null) { still.push(k); return }
        out.set(k, g)
        remember(k, g)
      })
    }
    missing = still
  } catch (err) {
    console.warn('[rated-title-cache] redis read failed (reading the database):', err instanceof Error ? err.message : err)
    redis = null   // and don't try to write to it either: one slow failure, not two
  }
  if (missing.length === 0) return out

  const loaded = await load(missing)
  const toStore: Record<string, RatedTitleFacts> = {}
  for (const k of missing) {
    const facts = loaded.get(k) ?? null
    out.set(k, facts)
    if (facts) { remember(k, facts); toStore[key(k)] = facts }
  }
  if (redis && Object.keys(toStore).length > 0) await redis.mset(toStore).catch(err => {
    console.warn('[rated-title-cache] redis write failed (next build reads them again):', err instanceof Error ? err.message : err)
  })
  return out
}
