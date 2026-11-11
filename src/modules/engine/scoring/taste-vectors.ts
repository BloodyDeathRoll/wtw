/**
 * The taste vectors (titles.taste_vec, migration 0029) of the candidates
 * formula v2 scores. Step 1's candidate RPCs return the titles_candidate
 * view, which doesn't carry the vector, so step 2 reads them here: one
 * query per 300 ids, run alongside the model's training load.
 *
 * Only vectors built at the current TASTE_FEATURE_VERSION count; a title
 * without one scores at the pool mean (formula-v2.ts).
 */
import 'server-only'

import { createServiceClient } from '@/lib/supabase/service'
import { TASTE_FEATURE_VERSION } from '@/lib/taste-scales/features'
import type { TitleRow } from '../types'

/** Ids per `in (...)` filter, to keep the request URL short. */
const ID_CHUNK = 300

export const vecKey = (t: Pick<TitleRow, 'type' | 'tmdb_id'>) => `${t.type}:${t.tmdb_id}`

/** pgvector comes back as its text form, "[0.1,-0.2,…]". */
export function parseVector(v: unknown): number[] | null {
  if (Array.isArray(v)) return v as number[]
  if (typeof v !== 'string') return null
  try {
    const parsed = JSON.parse(v)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

export async function fetchTasteVectors(
  titles: Pick<TitleRow, 'type' | 'tmdb_id'>[],
): Promise<Map<string, number[]>> {
  const wanted = new Set(titles.map(vecKey))
  const ids = [...new Set(titles.map(t => t.tmdb_id))]
  const db = createServiceClient()

  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += ID_CHUNK) chunks.push(ids.slice(i, i + ID_CHUNK))

  const vecs = new Map<string, number[]>()
  await Promise.all(chunks.map(async chunk => {
    const { data, error } = await db.from('titles').select('tmdb_id, type, taste_vec')
      .in('tmdb_id', chunk)
      .eq('taste_version', TASTE_FEATURE_VERSION).not('taste_vec', 'is', null)
    if (error) throw new Error(`Taste vectors failed (titles): ${error.message}`)
    for (const r of data ?? []) {
      const key = `${r.type}:${r.tmdb_id}`
      // A movie and a series can share a tmdb_id; keep only the keys asked for.
      if (!wanted.has(key)) continue
      const vec = parseVector(r.taste_vec)
      if (vec) vecs.set(key, vec)
    }
  }))
  return vecs
}
