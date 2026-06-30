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
  const cached = await getCachedRecommendations(user.id, tasteVersion)

  if (!cached) {
    return NextResponse.json(
      { error: 'Recommendation cache expired. Call /generate first.' },
      { status: 404 }
    )
  }

  const recommendation = cached.find(r => r.tmdb_id === tmdb_id)

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
