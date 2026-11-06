/**
 * Score specific titles for one user, outside a batch — the same steps 2 and
 * 6 the feed runs, so "Why it's a match" can explain ANY title the user is
 * looking at (a Watchlist entry saved weeks ago, a card whose batch expired)
 * from today's taste, with today's facts.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { scoreCandidates } from '../pipeline/step2-composite-score'
import { buildReasonPayloads, type ScoredTitleWithPayload } from '../pipeline/step6-reason-payload'
import { loadRatedByPerson, type RatedByPerson } from '../pipeline/step7-card-reason'
import type { DNASchema } from '@/types/dna'
import type { TitleRow } from '../types'

/** Everything TitleRow holds except the 1024-dim embedding nobody here reads. */
const COLUMNS = [
  'id', 'tmdb_id', 'title', 'type', 'synopsis', 'genres', 'release_year',
  'runtime_minutes', 'tmdb_rating', 'tmdb_vote_count', 'omdb_rating', 'crew',
  'pacing_tag', 'tone_tags', 'original_language', 'keywords',
  'narrative_metadata', 'enriched_at', 'created_at',
].join(', ')

export interface TitleKey {
  type: 'movie' | 'tv'
  tmdb_id: string
}

export async function loadTitleRows(keys: TitleKey[]): Promise<TitleRow[]> {
  const supabase = createServiceClient()
  const rows: TitleRow[] = []
  for (const type of ['movie', 'tv'] as const) {
    const ids = [...new Set(keys.filter(k => k.type === type).map(k => k.tmdb_id))]
    for (let i = 0; i < ids.length; i += 150) {
      const { data, error } = await supabase
        .from('titles')
        .select(COLUMNS)
        .eq('type', type)
        .in('tmdb_id', ids.slice(i, i + 150))
      if (error) throw error
      for (const r of (data ?? []) as unknown as TitleRow[]) {
        rows.push({ ...r, narrative_embedding: null, keywords: r.keywords ?? [], tone_tags: r.tone_tags ?? [] })
      }
    }
  }
  return rows
}

/**
 * The titles, scored and with their reason payloads, plus the user's
 * loved/liked titles per person (for "who made X, which you loved").
 * Titles not in the catalogue are simply absent.
 */
export async function scoreTitlesForUser(
  dna: DNASchema,
  keys: TitleKey[],
): Promise<{ items: ScoredTitleWithPayload[]; rated: RatedByPerson }> {
  const [rows, rated] = await Promise.all([loadTitleRows(keys), loadRatedByPerson(dna)])
  if (rows.length === 0) return { items: [], rated }
  const scored = await scoreCandidates(rows, dna)
  return { items: buildReasonPayloads(scored), rated }
}
