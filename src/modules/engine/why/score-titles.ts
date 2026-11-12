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

/** A title the viewer loved or liked, with what it's about — for "it's like X". */
export interface RatedForComparison {
  key: string
  title: string
  reaction: 'loved' | 'liked'
  genres: string[]
  keywords: string[]
  tone_tags: string[]
  synopsis: string | null
}

/** Newest-first; older ratings add little and the read stays one query per type. */
const MAX_COMPARE = 120

/** The viewer's loved/liked titles with their genres, story tags, moods and plot. Best-effort: [] on failure. */
export async function loadRatedForComparison(dna: DNASchema): Promise<RatedForComparison[]> {
  const reaction = new Map<string, 'loved' | 'liked'>()
  for (const s of [...dna.signals].reverse()) {
    if (reaction.size >= MAX_COMPARE) break
    if (s.reaction !== 'loved' && s.reaction !== 'liked') continue
    const k = `${s.type}:${s.tmdb_id}`
    if (!reaction.has(k)) reaction.set(k, s.reaction)
  }
  if (!reaction.size) return []
  try {
    const supabase = createServiceClient()
    const out: RatedForComparison[] = []
    for (const type of ['movie', 'tv'] as const) {
      const ids = [...reaction.keys()].filter(k => k.startsWith(`${type}:`)).map(k => k.slice(type.length + 1))
      if (!ids.length) continue
      const { data, error } = await supabase
        .from('titles')
        .select('tmdb_id, title, genres, keywords, tone_tags, synopsis')
        .eq('type', type)
        .in('tmdb_id', ids)
      if (error) throw error
      for (const r of (data ?? []) as Pick<TitleRow, 'tmdb_id' | 'title' | 'genres' | 'keywords' | 'tone_tags' | 'synopsis'>[]) {
        const key = `${type}:${r.tmdb_id}`
        out.push({
          key, title: r.title, reaction: reaction.get(key)!,
          genres: (r.genres ?? []).map(g => g.name.toLowerCase()),
          keywords: r.keywords ?? [], tone_tags: r.tone_tags ?? [], synopsis: r.synopsis ?? null,
        })
      }
    }
    return out
  } catch (err) {
    console.warn('[why] rated titles for comparison unavailable:', err instanceof Error ? err.message : err)
    return []
  }
}
