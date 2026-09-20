import { createServiceClient } from '@/lib/supabase/service'
import { getRedis } from '@/lib/redis'
import type { DNASchema } from '@/types/dna'
import { titleKey, type MediaType } from '@/lib/title-key'
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
  title:              string
  type:               'movie' | 'tv'
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
 * Read `users.dna` together with the row version a conditional save needs.
 * Goes straight to Postgres, deliberately: a read-modify-write that intends to
 * compare-and-set must not start from a cached snapshot.
 */
export async function loadDNAForUpdate(
  user_id: string,
): Promise<{ dna: DNASchema; updated_at: string } | null> {
  const { data, error } = await createServiceClient()
    .from('users')
    .select('dna, updated_at')
    .eq('id', user_id)
    .single<{ dna: DNASchema | null; updated_at: string }>()

  if (error || !data?.dna) return null
  return { dna: data.dna, updated_at: data.updated_at }
}

/**
 * Save only if nobody else has written the row since `seenUpdatedAt`.
 * Returns false when the row moved — the caller must re-read and redo its
 * work, never retry with the snapshot it already has.
 *
 * Why this exists (2026-09-20): `users.dna` is one JSONB column with several
 * writers, and a blind `update()` of the whole object silently reverts
 * whatever landed between the reader's read and its write. That is fine while
 * every writer runs inside a request the UI serialises — and stopped being
 * fine when the batch refresh started writing from `after()`, concurrently
 * with the next click.
 */
export async function saveDNAIfUnchanged(
  user_id: string,
  dna: DNASchema,
  seenUpdatedAt: string,
): Promise<boolean> {
  const { data, error } = await createServiceClient()
    .from('users')
    .update({ dna, updated_at: new Date().toISOString() })
    .eq('id', user_id)
    .eq('updated_at', seenUpdatedAt)
    .select('id')

  if (error) throw new Error(`saveDNAIfUnchanged: ${error.message}`)
  const saved = (data?.length ?? 0) > 0
  if (saved) await invalidateDNACache(user_id)
  return saved
}

export type DNAUpdateOutcome = 'saved' | 'unchanged' | 'missing' | 'conflict'

/**
 * Read-modify-write `users.dna` under a compare-and-set, redoing the work
 * against a fresh read when another writer got there first.
 *
 * `mutate` returns whether it changed anything; false means "nothing to
 * persist" and is reported as `unchanged` without a write. It must be safe to
 * run more than once — on a conflict it is re-run against the newer row, never
 * re-saved against the old one.
 *
 * `attempts` defaults to 2, which suits a caller with a backstop — the
 * session-end fold picks up what the per-click merge missed. A caller whose
 * write is the ONLY record of something must ask for more: losing it has no
 * recovery path, and the contending writers here are rare enough (the batch
 * refresh fires once every five ratings) that a few more tries settle it.
 */
export async function withDNAUpdate(
  user_id: string,
  mutate: (dna: DNASchema) => boolean | Promise<boolean>,
  attempts = 2,
): Promise<DNAUpdateOutcome> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const row = await loadDNAForUpdate(user_id)
    if (!row) return 'missing'
    if (!(await mutate(row.dna))) return 'unchanged'
    if (await saveDNAIfUnchanged(user_id, row.dna, row.updated_at)) return 'saved'
    // Let the writer that beat us finish before re-reading, so a retry is not
    // simply a second race against the same in-flight write.
    if (attempt < attempts - 1) await new Promise(r => setTimeout(r, 25 * (attempt + 1)))
  }
  return 'conflict'
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

/**
 * Catalog rows for a set of tmdb_ids, keyed by `titleKey(type, tmdb_id)`.
 * A movie and a TV show can share an id, so BOTH rows come back and the caller
 * picks by composite key — keying on the bare id let the TV row overwrite the
 * movie row, which signaled ratings against the wrong title (see
 * src/lib/title-key.ts). Use `pickTitle` when the type isn't known.
 */
export async function fetchTitleCrew(tmdb_ids: string[]): Promise<Map<string, TitleRow>> {
  if (tmdb_ids.length === 0) return new Map()

  const db = createServiceClient()
  const { data, error } = await db
    .from('titles')
    .select('tmdb_id, title, type, crew, pacing_tag, tone_tags, narrative_metadata')
    .in('tmdb_id', [...new Set(tmdb_ids)])

  if (error) throw new Error(`fetchTitleCrew: ${error.message}`)

  const map = new Map<string, TitleRow>()
  for (const row of data ?? []) {
    map.set(titleKey(row.type as MediaType, row.tmdb_id), row as TitleRow)
  }
  return map
}

/**
 * The row for (tmdb_id, type) from a fetchTitleCrew map. With no type (legacy
 * history rows), returns the row only when exactly one catalog title has that
 * id — a colliding id is ambiguous and must not be guessed.
 */
export function pickTitle(
  map: Map<string, TitleRow>,
  tmdb_id: string,
  type: MediaType | null | undefined,
): TitleRow | undefined {
  if (type) return map.get(titleKey(type, tmdb_id))
  const rows = [...map.values()].filter(t => t.tmdb_id === tmdb_id)
  return rows.length === 1 ? rows[0] : undefined
}

// Increment taste_version and stamp last_updated — call before every saveDNA
export function bumpVersion(dna: DNASchema): void {
  dna.metadata.taste_version += 1
  dna.metadata.last_updated   = new Date().toISOString()
}
