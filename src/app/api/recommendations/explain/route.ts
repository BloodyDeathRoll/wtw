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
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getCachedRecommendations } from '@/modules/engine'
import type { DNASchema } from '@/types/dna'

export async function GET(req: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
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
  // Batches are cached per content type (rec:{user}:{version}:{type}), so
  // read the entry this card actually came from. Without a `type` the caller
  // can't say which, and both are checked.
  const cached = type
    ? await getCachedRecommendations(user.id, tasteVersion, type === 'movie' ? 'movies' : 'series')
    : (await getCachedRecommendations(user.id, tasteVersion, 'movies')) ??
      (await getCachedRecommendations(user.id, tasteVersion, 'series'))

  if (!cached) {
    return NextResponse.json(
      { error: 'Recommendation cache expired. Call /generate first.' },
      { status: 404 }
    )
  }

  // Match on the composite (tmdb_id, type) when the caller tells us the type.
  // Without it we can only take the first bare-id match, which is exactly how a
  // colliding movie/TV pair ends up showing each other's breakdown — so warn
  // loudly when the cache actually holds an ambiguous pair.
  const matches = cached.filter(r => r.tmdb_id === tmdb_id)
  if (!type && matches.length > 1) {
    console.warn(
      `[recommendations/explain] ambiguous tmdb_id ${tmdb_id}: ${matches.length} cached recs share it and no type was given`,
    )
  }
  const recommendation = type
    ? matches.find(r => r.type === type)
    : matches[0]

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
