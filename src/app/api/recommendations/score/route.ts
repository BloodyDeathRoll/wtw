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
 * POST { titles: [{ type, tmdb_id }] } (v3 Q7): the match alone for up to
 * 60 titles at once, for Search's results and the Watchlist's rows.
 *   200 { matches: { "movie:603": 0.87, … } }   a title it can't score is absent
 *
 * `type` is required: TMDB numbers movies and series separately, and the
 * ranges collide (1396 is a film and Breaking Bad).
 */
import { NextRequest, NextResponse } from 'next/server'
import { logAuthFailure } from '@/lib/auth-guard'
import { createClient } from '@/lib/supabase/server'
import { getAuthUser } from '@/lib/supabase/auth-user'
import { scoreMatches, scoreOneTitle } from '@/modules/engine/score-one'
import type { TitleKey } from '@/modules/engine/why/score-titles'

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

/** More than a Watchlist page or a result set ever asks for at once. */
const MAX_TITLES = 60

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) {
    logAuthFailure('/api/recommendations/score')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => null)) as { titles?: unknown } | null
  const titles = Array.isArray(body?.titles) ? body.titles : null
  const keys = titles?.filter((t): t is TitleKey =>
    !!t && typeof t === 'object' &&
    ((t as TitleKey).type === 'movie' || (t as TitleKey).type === 'tv') &&
    typeof (t as TitleKey).tmdb_id === 'string' && /^\d+$/.test((t as TitleKey).tmdb_id))
  if (!titles || !keys || keys.length !== titles.length || keys.length > MAX_TITLES) {
    return NextResponse.json({ error: `titles: up to ${MAX_TITLES} of { type: movie|tv, tmdb_id: numeric string }` }, { status: 400 })
  }

  const t0 = Date.now()
  try {
    const matches = await scoreMatches(user.id, keys.map(k => ({ type: k.type, tmdb_id: k.tmdb_id })))
    console.log(`[score-many] ${Object.keys(matches).length}/${keys.length} scored ${Date.now() - t0}ms`)
    return NextResponse.json({ matches })
  } catch (err) {
    console.error(`[score-many] ${keys.length} titles failed after ${Date.now() - t0}ms:`, err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Could not score these titles right now' }, { status: 500 })
  }
}
