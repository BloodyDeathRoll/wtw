/**
 * GET /api/recommendations/ratings
 *
 * Returns the signed-in user's own rating history for the "Your ratings"
 * screen: how many titles they've reacted to, how they split across
 * loved / liked / disliked, and the titles they've removed from their feed.
 *
 * A title can be re-rated (e.g. liked then later loved). We dedupe by
 * recommendation_id keeping the most recent row, so the breakdown reflects
 * each title's *current* standing rather than double-counting flip-flops.
 *
 * Each item carries the parsed { tmdb_id, media_type } so the screen can
 * re-rate a title through POST /api/recommendations/feedback and land on the
 * exact same recommendation_id (prefixed rows → media_type from the prefix;
 * legacy bare ids → media_type null, which the feedback route round-trips).
 *
 * Reads through the user-scoped client — the recommendation_feedback and
 * removed_titles RLS select-own policies scope the rows to the caller.
 */

import { NextResponse } from 'next/server'
import { logAuthFailure } from '@/lib/auth-guard'
import { createClient } from '@/lib/supabase/server'
import { getAuthUser } from '@/lib/supabase/auth-user'
import { tmdbPosterUrl } from '@/lib/tmdb'
import type { Reaction } from '@/types/dna'

export type MediaType = 'movie' | 'tv'

/** What a Seen row shows beside the poster (docs/plan/v3/SEEN.md DEC-1): year · length · ★. Null when the title isn't in our catalogue. */
export interface TitleFacts {
  year: number | null
  /** The card's length line: "2h 10m", "~45m episodes", "Film" or "Series". */
  meta: string | null
  /** TMDB's score, the card's ★. */
  star: number | null
}

export interface RatingItem extends TitleFacts {
  id: string
  title: string | null
  rating: Reaction
  created_at: string
  tmdb_id: string
  media_type: MediaType | null
  poster_url: string | null
}

export interface RemovedItem extends TitleFacts {
  title: string | null
  tmdb_id: string
  media_type: MediaType
  removed_at: string
  poster_url: string | null
}

// PostgREST answers at most 1,000 rows a request: a list longer than that is read a page at a time, and the titles
// in chunks (#359: 1,114 ids matched 1,261 rows, and 261 posters were silently dropped).
const PAGE = 1000
const ID_CHUNK = 300

/** Every row of a query, a page at a time. `page(from, to)` is the query with `.range(from, to)` on a stable order. */
async function readAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1)
    if (error) throw error
    out.push(...(data ?? []))
    if (!data || data.length < PAGE) return out
  }
}

/** The feed card's length line (toUIRecommendations in src/lib/rec-page.ts), for a Seen row. */
function lengthLine(type: MediaType, runtime: number | null): string {
  if (type === 'movie') return runtime ? `${Math.floor(runtime / 60)}h ${runtime % 60}m` : 'Film'
  return runtime ? `~${runtime}m episodes` : 'Series'
}

export interface RatingsSummary {
  counts: Record<Reaction | 'removed', number>
  items: RatingItem[]
  removed: RemovedItem[]
}

/** Split a stored recommendation_id back into { media_type, tmdb_id }.
 *  Prefixed ids ("movie:603") carry their type; legacy/mock ids ("tt-foo")
 *  don't, and round-trip through the feedback route as a bare tmdb_id. */
function parseRecId(recId: string): { media_type: MediaType | null; tmdb_id: string } {
  const m = /^(movie|tv):(.+)$/.exec(recId)
  if (m) return { media_type: m[1] as MediaType, tmdb_id: m[2] }
  return { media_type: null, tmdb_id: recId }
}

export async function GET() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) {
    logAuthFailure('/api/recommendations/ratings')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let feedback: { recommendation_id: string; title: string | null; rating: string; created_at: string }[]
  let removedRows: { tmdb_id: string; media_type: string; title: string | null; removed_at: string }[]
  try {
    ;[feedback, removedRows] = await Promise.all([
      readAll((from, to) =>
        supabase
          .from('recommendation_feedback')
          .select('recommendation_id, title, rating, created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .order('id')
          .range(from, to),
      ),
      readAll((from, to) =>
        supabase
          .from('removed_titles')
          .select('tmdb_id, media_type, title, removed_at')
          .eq('user_id', user.id)
          .order('removed_at', { ascending: false })
          .order('id')
          .range(from, to),
      ),
    ])
  } catch {
    return NextResponse.json({ error: 'Failed to load ratings' }, { status: 500 })
  }

  // Rows arrive newest-first; the first time we see a recommendation_id is its
  // latest rating. Keep that, drop older re-rates of the same title.
  const seen = new Set<string>()
  const counts: Record<Reaction | 'removed', number> = { loved: 0, liked: 0, disliked: 0, removed: 0 }

  const dedupedFeedback: { key: string; title: string | null; rating: Reaction; created_at: string; tmdb_id: string; media_type: MediaType | null }[] = []
  for (const row of feedback ?? []) {
    const key = row.recommendation_id
    if (seen.has(key)) continue
    seen.add(key)
    const rating = row.rating as Reaction
    if (rating in counts) counts[rating] += 1
    const { media_type, tmdb_id } = parseRecId(key)
    dedupedFeedback.push({ key, title: row.title ?? null, rating, created_at: row.created_at, tmdb_id, media_type })
  }
  counts.removed = removedRows.length

  // Resolve posters for the tile backgrounds. poster_path is already cached on
  // the titles row (no external TMDB call); one batched lookup by tmdb_id.
  // Ids by type: a movie and a series can share a numeric id, so asking per type keeps each answer to the rows we want.
  const idsOf: Record<MediaType, Set<string>> = { movie: new Set(), tv: new Set() }
  for (const r of dedupedFeedback) if (r.media_type) idsOf[r.media_type].add(r.tmdb_id)
  for (const r of removedRows) idsOf[r.media_type as MediaType]?.add(r.tmdb_id)
  // titles is uniquely keyed on (tmdb_id, type) — a movie and a TV show can
  // share a numeric tmdb_id (migration 0008) — so key posters by the composite
  // to avoid attaching the wrong artwork. Legacy bare ids (media_type null) are
  // mock ids absent from titles, so they resolve to no poster.
  const posterByKey = new Map<string, string | null>()
  const factsByKey = new Map<string, TitleFacts>()
  const chunks: { type: MediaType; ids: string[] }[] = []
  for (const type of ['movie', 'tv'] as const) {
    const ids = [...idsOf[type]]
    for (let i = 0; i < ids.length; i += ID_CHUNK) chunks.push({ type, ids: ids.slice(i, i + ID_CHUNK) })
  }
  const answers = await Promise.all(
    chunks.map(({ type, ids }) =>
      supabase
        .from('titles')
        .select('tmdb_id, type, poster_path, release_year, runtime_minutes, tmdb_rating')
        .eq('type', type)
        .in('tmdb_id', ids),
    ),
  )
  // A chunk that fails leaves its rows without a poster, as before; the list itself still loads.
  for (const { data: titleRows } of answers) {
    for (const t of titleRows ?? []) {
      const key = `${t.tmdb_id}:${t.type}`
      posterByKey.set(key, tmdbPosterUrl(t.poster_path as string | null))
      factsByKey.set(key, {
        year: (t.release_year as number | null) ?? null,
        meta: lengthLine(t.type as MediaType, (t.runtime_minutes as number | null) ?? null),
        star: (t.tmdb_rating as number | null) ?? null,
      })
    }
  }
  const posterFor = (tmdb_id: string, media_type: MediaType | null): string | null =>
    media_type ? posterByKey.get(`${tmdb_id}:${media_type}`) ?? null : null
  const NO_FACTS: TitleFacts = { year: null, meta: null, star: null }
  const factsFor = (tmdb_id: string, media_type: MediaType | null): TitleFacts =>
    (media_type && factsByKey.get(`${tmdb_id}:${media_type}`)) || NO_FACTS

  const items: RatingItem[] = dedupedFeedback.map((r) => ({
    id: r.key,
    title: r.title,
    rating: r.rating,
    created_at: r.created_at,
    tmdb_id: r.tmdb_id,
    media_type: r.media_type,
    poster_url: posterFor(r.tmdb_id, r.media_type),
    ...factsFor(r.tmdb_id, r.media_type),
  }))

  const removed: RemovedItem[] = removedRows.map((r) => ({
    title: r.title ?? null,
    tmdb_id: r.tmdb_id,
    media_type: r.media_type as MediaType,
    removed_at: r.removed_at,
    poster_url: posterFor(r.tmdb_id, r.media_type as MediaType),
    ...factsFor(r.tmdb_id, r.media_type as MediaType),
  }))

  const summary: RatingsSummary = { counts, items, removed }
  return NextResponse.json(summary)
}
