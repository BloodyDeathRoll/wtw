/**
 * POST /api/recommendations/why-lines   { ids: ["movie:123", "tv:456", …] }
 *
 * Fresh short "why" lines for the Watchlist's cards, built from facts — no
 * model (src/modules/engine/why, `cardLinesForTitles`). A saved card keeps the
 * line it had when saved, and before 2026-11-06 that could be an AI paragraph
 * with invented facts; the Watchlist shows these instead.
 *
 * 200 { lines: { "movie:123": "…" } } — a title not in the catalogue is
 * absent. { lines: null } for a brand-new user: keep the saved lines (the
 * popularity line, which is true).
 */

import { NextRequest, NextResponse } from 'next/server'
import { logAuthFailure } from '@/lib/auth-guard'
import { createClient } from '@/lib/supabase/server'
import { getAuthUser } from '@/lib/supabase/auth-user'
import { enforceRateLimit } from '@/lib/rate-limit'
import { cardLinesForTitles } from '@/modules/engine'

/** The Watchlist holds at most 200 entries (src/lib/watchlist.ts). */
const MAX_IDS = 200
const RATE_LIMIT = { scope: 'why-lines', perUser: 30, windowSec: 600 }

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) {
    logAuthFailure('/api/recommendations/why-lines')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => null) as { ids?: unknown } | null
  const ids = Array.isArray(body?.ids) ? body.ids : null
  if (!ids || ids.length > MAX_IDS || !ids.every(id => typeof id === 'string' && /^(movie|tv):\d+$/.test(id))) {
    return NextResponse.json({ error: `ids: up to ${MAX_IDS} "movie:<id>" or "tv:<id>"` }, { status: 400 })
  }

  const limited = await enforceRateLimit(req, user.id, RATE_LIMIT)
  if (limited) return limited

  try {
    const keys = [...new Set(ids as string[])].map(id => {
      const [type, tmdb_id] = id.split(':') as ['movie' | 'tv', string]
      return { type, tmdb_id }
    })
    return NextResponse.json({ lines: await cardLinesForTitles(user.id, keys) })
  } catch (err) {
    console.error('[why-lines] failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Could not build the lines' }, { status: 500 })
  }
}
