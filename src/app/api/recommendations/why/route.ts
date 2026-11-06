/**
 * GET /api/recommendations/why?tmdb_id=<id>&type=movie|tv
 *
 * The "Why" text in the "Why it's a match" sheet: two or three sentences,
 * like a friend recommending the title, written from facts only and checked
 * before it's shown (src/modules/engine/why). Works for any title in the
 * catalogue — a feed card or a Watchlist entry — because it scores the title
 * fresh for this user. Saved for 3 days per user and title.
 *
 * 200 { text, source: 'ai' | 'facts' } — `text` is null when there's nothing
 * better than what the sheet already shows (a brand-new user, or a title not
 * in the catalogue).
 */

import { NextRequest, NextResponse } from 'next/server'
import { logAuthFailure } from '@/lib/auth-guard'
import { createClient } from '@/lib/supabase/server'
import { getAuthUser } from '@/lib/supabase/auth-user'
import { enforceRateLimit } from '@/lib/rate-limit'
import { whyForTitle } from '@/modules/engine'

// A write is 2–4 model calls with a 20s ceiling of its own.
export const maxDuration = 30

/** Each open costs model calls on a free budget; a cached one costs nothing. */
const RATE_LIMIT = { scope: 'why-text', perUser: 40, windowSec: 600 }

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) {
    logAuthFailure('/api/recommendations/why')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const tmdb_id = req.nextUrl.searchParams.get('tmdb_id')
  const type = req.nextUrl.searchParams.get('type')
  if (!tmdb_id || !/^\d+$/.test(tmdb_id) || (type !== 'movie' && type !== 'tv')) {
    return NextResponse.json({ error: 'tmdb_id and type (movie|tv) are required' }, { status: 400 })
  }

  const limited = await enforceRateLimit(req, user.id, RATE_LIMIT)
  if (limited) return limited

  try {
    const why = await whyForTitle(user.id, { type, tmdb_id })
    return NextResponse.json({ text: why?.text ?? null, source: why?.source ?? null })
  } catch (err) {
    console.error('[why] failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ text: null, source: null })
  }
}
