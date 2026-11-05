/**
 * GET /api/recommendations/explain?tmdb_id=<id>
 *
 * Returns the stored explanation and full reason_payload for a specific
 * recommendation. Powers the "Why this?" button.
 *
 * Reads from the Redis cache populated by /generate — no LLM calls.
 * Returns 404 if the recommendation isn't in the current cache
 * (i.e. generate hasn't been called yet or cache expired).
 *
 * Query params:
 *   tmdb_id  (required) — the TMDB content ID
 *   type     (optional) — 'movie' | 'tv'. Pass it: TMDB numbers movies and TV
 *                         separately and the ranges collide (1396 is both a film
 *                         and Breaking Bad), so tmdb_id alone can match the wrong
 *                         cached recommendation and show the wrong breakdown.
 *                         Optional only for backwards compatibility with callers
 *                         that don't send it yet.
 */

import { NextRequest, NextResponse } from 'next/server'
import { logAuthFailure } from '@/lib/auth-guard'
import { createClient } from '@/lib/supabase/server'
import { getAuthUser } from '@/lib/supabase/auth-user'
import { createServiceClient } from '@/lib/supabase/service'
import { getCachedRecommendations } from '@/modules/engine'
import type { DNASchema, RecommendationResult } from '@/types/dna'
import type { ContentType } from '@/lib/content-type'

export async function GET(req: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────
  const supabase = await createClient()
  const user = await getAuthUser(supabase)

  if (!user) {
    logAuthFailure('/api/recommendations/explain')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Parse query params ────────────────────────────────────
  const tmdb_id = req.nextUrl.searchParams.get('tmdb_id')
  if (!tmdb_id) {
    return NextResponse.json({ error: 'tmdb_id is required' }, { status: 400 })
  }
  const typeParam = req.nextUrl.searchParams.get('type')
  const type = typeParam === 'movie' || typeParam === 'tv' ? typeParam : null

  // ── Get current taste_version from DNA ───────────────────
  // Needed to construct the correct Redis cache key
  const serviceClient = createServiceClient()
  const { data: userData } = await serviceClient
    .from('users')
    .select('dna')
    .eq('id', user.id)
    .single<{ dna: Pick<DNASchema, 'metadata'> | null }>()

  const tasteVersion = userData?.dna?.metadata?.taste_version
  if (tasteVersion == null) {
    return NextResponse.json(
      { error: 'Profile not set up yet. Complete onboarding first.' },
      { status: 404 }
    )
  }

  // ── Read from Redis cache ─────────────────────────────────
  // Batches are cached per picker setting (rec:{user}:{version}:{type}):
  // Movies, Series and Both each have their own. A card can come from its own
  // type's batch or from the Both batch, so look in the type's batch first,
  // then in Both. (Before 2026-11-05 Both was never checked, so with the
  // picker on Both every "Why it's a match" said the breakdown wasn't ready.)
  // Without a `type` the caller can't say which, and all three are checked.
  const contentTypes: ContentType[] = type
    ? [type === 'movie' ? 'movies' : 'series', 'all']
    : ['movies', 'series', 'all']

  let anyCache = false
  let recommendation: RecommendationResult | undefined
  for (const contentType of contentTypes) {
    const cached = await getCachedRecommendations(user.id, tasteVersion, contentType)
    if (!cached) continue
    anyCache = true

    // Match on the composite (tmdb_id, type) when the caller tells us the
    // type. Without it we can only take the first bare-id match, which is
    // exactly how a colliding movie/TV pair ends up showing each other's
    // breakdown — so warn loudly when a batch holds an ambiguous pair.
    const matches = cached.filter(r => r.tmdb_id === tmdb_id)
    if (!type && matches.length > 1) {
      console.warn(
        `[recommendations/explain] ambiguous tmdb_id ${tmdb_id}: ${matches.length} cached recs share it and no type was given`,
      )
    }
    recommendation = type ? matches.find(r => r.type === type) : matches[0]
    if (recommendation) break
  }

  if (!anyCache) {
    return NextResponse.json(
      { error: 'Recommendation cache expired. Call /generate first.' },
      { status: 404 }
    )
  }

  if (!recommendation) {
    return NextResponse.json(
      { error: `No recommendation found for tmdb_id ${tmdb_id} in current session.` },
      { status: 404 }
    )
  }

  return NextResponse.json({
    tmdb_id:        recommendation.tmdb_id,
    title:          recommendation.title,
    explanation:    recommendation.explanation,
    reason_payload: recommendation.reason_payload,
    is_stretch_pick: recommendation.is_stretch_pick,
  })
}
