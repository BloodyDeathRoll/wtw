/**
 * POST /api/watchlist/saved — record Watchlist saves in the fingerprint now (v3 Q6, SEARCH.md DEC-4).
 *
 * Body: { added?: string[], removed?: string[] }   // "type:tmdb_id"
 * → 200 { ok: true, changed: boolean } · 400 bad ids · 401 · 404 no profile yet · 409 lost the write races · 429
 *
 * The same mark a save from For you gets (src/modules/session/watchlist-intent.ts): `accepted: true, rating: null`
 * in learning_loop.recommendation_history, so the feed stops serving the title; an unsave clears it. A save is
 * interest, not taste: no taste_version bump, exactly as the For you path in /api/session/end (a bump would bust the
 * rec and embedding caches for nothing). The only difference is timing: For you's saves ride on the next session
 * end; a save in Search is recorded at once (Eran on #368, "A"). The client keeps a save queued for the next session
 * end when this call fails, so nothing is lost either way.
 *
 * Written under a compare-and-set (withDNAUpdate): `users.dna` has other writers (a rating landing at the same
 * moment), and a blind write of the whole object would revert theirs.
 */
import { NextRequest, NextResponse } from 'next/server'
import { logAuthFailure } from '@/lib/auth-guard'
import { createClient } from '@/lib/supabase/server'
import { getAuthUser } from '@/lib/supabase/auth-user'
import { enforceRateLimit } from '@/lib/rate-limit'
import { withDNAUpdate } from '@/modules/dna/lib/load-save'
import { markSavedInHistory, unmarkSavedInHistory } from '@/modules/session/watchlist-intent'

/** More than a person saves in one go; the client sends what's queued. */
const MAX_IDS = 60
const KEY = /^(movie|tv):\d+$/
const RATE_LIMIT = { scope: 'watchlist-saved', perUser: 120, windowSec: 10 * 60 }
/** The save is only queued on the client if this fails, so a few more tries are cheap. */
const ATTEMPTS = 4

const keys = (v: unknown): string[] | null =>
  v === undefined ? [] : Array.isArray(v) && v.length <= MAX_IDS && v.every(k => typeof k === 'string' && KEY.test(k)) ? (v as string[]) : null

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) {
    logAuthFailure('/api/watchlist/saved')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const limited = await enforceRateLimit(req, user.id, RATE_LIMIT)
  if (limited) return limited

  const body = (await req.json().catch(() => null)) as { added?: unknown; removed?: unknown } | null
  const added = keys(body?.added)
  const removed = keys(body?.removed)
  if (!added || !removed) {
    return NextResponse.json({ error: `added / removed: up to ${MAX_IDS} "movie:<id>" or "tv:<id>" keys` }, { status: 400 })
  }
  if (added.length === 0 && removed.length === 0) return NextResponse.json({ ok: true, changed: false })

  const outcome = await withDNAUpdate(
    user.id,
    dna => {
      const history = dna.learning_loop.recommendation_history
      // A title both unsaved and saved in one call ends up saved: the unsave goes first, as in /api/session/end.
      let next = unmarkSavedInHistory(history, removed)
      next = markSavedInHistory(next, added, {
        session: dna.metadata.total_sessions,
        fingerprintVersion: dna.metadata.taste_version,
      })
      if (next === history) return false
      dna.learning_loop.recommendation_history = next
      return true
    },
    ATTEMPTS,
  )
  if (outcome === 'missing') return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  if (outcome === 'conflict') {
    console.error(`[watchlist/saved] lost ${ATTEMPTS} write races; left for the next session end`)
    return NextResponse.json({ error: 'Not recorded' }, { status: 409 })
  }
  return NextResponse.json({ ok: true, changed: outcome === 'saved' })
}
