/**
 * Loads what the taste model trains on: the person's rated signals, their
 * this-or-that picks (play_events `duel` with a `chosen`, from the season
 * and onboarding alike), and the taste vectors of every title involved, in
 * one titles query (chunked). PLAN P1-D4.
 */
import 'server-only'

import type { DNASchema } from '@/types/dna'
import { createServiceClient } from '@/lib/supabase/service'
import { TASTE_FEATURE_VERSION } from '@/lib/taste-scales/features'
import { parseTitleKey, titleKey, type MediaType } from '@/lib/title-key'
import { buildTraining, type DuelPick, type TastePair, type TasteRow } from './taste-model'

const PAGE = 1000
/** Ids per `in (...)` filter, to keep the request URL short. */
const ID_CHUNK = 300

/**
 * `holdOut` (title keys) is for evaluation only (scripts/eval): picks that
 * touch a held-out title are dropped, so a model is never scored on a title
 * its own training already ranked.
 */
export async function loadTasteTraining(dna: DNASchema, userId: string, holdOut?: Set<string>): Promise<{ rows: TasteRow[]; pairs: TastePair[] }> {
  const db = createServiceClient()

  const picks: DuelPick[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from('play_events').select('payload')
      .eq('user_id', userId).eq('kind', 'duel').not('payload->>chosen', 'is', null)
      .order('id').range(from, from + PAGE - 1)
    if (error) throw new Error(`Taste training failed (play_events): ${error.message}`)
    for (const { payload } of data ?? []) {
      const p = payload as Partial<DuelPick>
      if (typeof p.a !== 'string' || typeof p.b !== 'string' || typeof p.chosen !== 'string') continue
      if (holdOut?.has(p.a) || holdOut?.has(p.b)) continue
      picks.push({ a: p.a, b: p.b, chosen: p.chosen })
    }
    if (!data || data.length < PAGE) break
  }

  const keys = new Set<string>(dna.signals.map(s => titleKey(s.type, s.tmdb_id)))
  for (const p of picks) { keys.add(p.a); keys.add(p.b) }
  // A bare id (no `movie:`/`tv:`) can't be matched to one title; leave it out of the query.
  const ids = [...new Set([...keys].map(parseTitleKey).filter(k => k.type).map(k => k.tmdb_id))]

  const vecs = new Map<string, number[]>()
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const { data, error } = await db.from('titles').select('tmdb_id, type, taste_vec')
      .in('tmdb_id', ids.slice(i, i + ID_CHUNK))
      .eq('taste_version', TASTE_FEATURE_VERSION).not('taste_vec', 'is', null)
    if (error) throw new Error(`Taste training failed (titles): ${error.message}`)
    for (const r of data ?? []) {
      const key = titleKey(r.type as MediaType, r.tmdb_id as string)
      // A movie and a series can share a tmdb_id; keep only the keys asked for.
      if (!keys.has(key)) continue
      // pgvector comes back as its text form, "[0.1,-0.2,…]".
      vecs.set(key, typeof r.taste_vec === 'string' ? JSON.parse(r.taste_vec) : r.taste_vec)
    }
  }

  return buildTraining(dna.signals, picks, vecs)
}
