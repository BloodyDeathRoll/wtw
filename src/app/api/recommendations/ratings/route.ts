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
import { createClient } from '@/lib/supabase/server'
import { tmdbPosterUrl } from '@/lib/tmdb'
import type { Reaction } from '@/types/dna'

export type MediaType = 'movie' | 'tv'

export interface RatingItem {
  id: string
  title: string | null
  rating: Reaction
  created_at: string
  tmdb_id: string
  media_type: MediaType | null
  poster_url: string | null
}

export interface RemovedItem {
  title: string | null
  tmdb_id: string
  media_type: MediaType
  removed_at: string
  poster_url: string | null
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
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const [{ data: feedback, error: fErr }, { data: removedRows, error: rErr }] = await Promise.all([
    supabase
      .from('recommendation_feedback')
      .select('recommendation_id, title, rating, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('removed_titles')
      .select('tmdb_id, media_type, title, removed_at')
      .eq('user_id', user.id)
      .order('removed_at', { ascending: false }),
  ])

  if (fErr || rErr) {
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
  counts.removed = removedRows?.length ?? 0

  // Resolve posters for the tile backgrounds. poster_path is already cached on
  // the titles row (no external TMDB call); one batched lookup by tmdb_id.
  const tmdbIds = [
    ...dedupedFeedback.map((r) => r.tmdb_id),
    ...(removedRows ?? []).map((r) => r.tmdb_id),
  ]
  // titles is uniquely keyed on (tmdb_id, type) — a movie and a TV show can
  // share a numeric tmdb_id (migration 0008) — so key posters by the composite
  // to avoid attaching the wrong artwork. Legacy bare ids (media_type null) are
  // mock ids absent from titles, so they resolve to no poster.
  const posterByKey = new Map<string, string | null>()
  if (tmdbIds.length > 0) {
    const { data: titleRows } = await supabase
      .from('titles')
      .select('tmdb_id, type, poster_path')
      .in('tmdb_id', [...new Set(tmdbIds)])
    for (const t of titleRows ?? []) {
      posterByKey.set(`${t.tmdb_id}:${t.type}`, tmdbPosterUrl(t.poster_path as string | null))
    }
  }
  const posterFor = (tmdb_id: string, media_type: MediaType | null): string | null =>
    media_type ? posterByKey.get(`${tmdb_id}:${media_type}`) ?? null : null

  const items: RatingItem[] = dedupedFeedback.map((r) => ({
    id: r.key,
    title: r.title,
    rating: r.rating,
    created_at: r.created_at,
    tmdb_id: r.tmdb_id,
    media_type: r.media_type,
    poster_url: posterFor(r.tmdb_id, r.media_type),
  }))

  const removed: RemovedItem[] = (removedRows ?? []).map((r) => ({
    title: r.title ?? null,
    tmdb_id: r.tmdb_id,
    media_type: r.media_type as MediaType,
    removed_at: r.removed_at,
    poster_url: posterFor(r.tmdb_id, r.media_type as MediaType),
  }))

  const summary: RatingsSummary = { counts, items, removed }
  return NextResponse.json(summary)
}
