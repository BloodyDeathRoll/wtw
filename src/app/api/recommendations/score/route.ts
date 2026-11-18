/**
 * GET /api/recommendations/score?type=movie|tv&tmdb_id=<id>
 *
 * v3 M1: one title scored for the signed-in user, outside a batch
 * (src/modules/engine/score-one.ts). The match the feed would show and the
 * same breakdown `/explain` returns, from today's profile.
 *
 *   200 { scored: true, tmdb_id, type, title, match, composite, explanation,
 *         card_line, reason_payload, is_stretch_pick, pool, taste_version }
 *   200 { scored: false, reason }   not in the catalogue, cold start, v1, …:
 *                                   show no ring and no breakdown (plan DEC-5)
 *
 * Nothing calls it yet: M2 (fresh breakdowns) and Q5 (Search) will.
 * `type` is required: TMDB numbers movies and series separately, and the
 * ranges collide (1396 is a film and Breaking Bad).
 */
import { NextRequest, NextResponse } from 'next/server'
import { logAuthFailure } from '@/lib/auth-guard'
import { createClient } from '@/lib/supabase/server'
import { getAuthUser } from '@/lib/supabase/auth-user'
import { scoreOneTitle } from '@/modules/engine/score-one'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) {
    logAuthFailure('/api/recommendations/score')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const type = req.nextUrl.searchParams.get('type')
  const tmdbId = req.nextUrl.searchParams.get('tmdb_id')
  if ((type !== 'movie' && type !== 'tv') || !tmdbId || !/^\d+$/.test(tmdbId)) {
    return NextResponse.json({ error: 'type (movie|tv) and a numeric tmdb_id are required' }, { status: 400 })
  }

  const t0 = Date.now()
  try {
    const result = await scoreOneTitle(user.id, { type, tmdb_id: tmdbId })
    console.log(`[score-one] ${type}:${tmdbId} ${result.scored ? `${Math.round(result.match * 100)}% (pool ${result.pool.built})` : `not scored: ${result.reason}`} ${Date.now() - t0}ms`)
    return NextResponse.json(result)
  } catch (err) {
    console.error(`[score-one] ${type}:${tmdbId} failed after ${Date.now() - t0}ms:`, err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Could not score this title right now' }, { status: 500 })
  }
}
