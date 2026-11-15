/**
 * POST /api/account/start-over — "Start my taste over" on the You tab (Eran, 2026-11-15). Body:
 * { confirm: 'start-over' }.
 *
 * Wipes the signed-in user's taste back to a first run (src/lib/reset-taste.ts): ratings, the taste profile and
 * its caches, the feed's ready-made picks, and the onboarding, chat and game answers. Keeps the Watchlist, the
 * titles taken off the feed, and the games' scores. The old DNA is snapshotted first. The client then opens `/`,
 * which sends them through the onboarding again.
 *
 * Only behind the tab bar (`NAV_TABS`), since the button lives on the You tab.
 */
import { NextRequest, NextResponse } from 'next/server'
import { logAuthFailure } from '@/lib/auth-guard'
import { createClient } from '@/lib/supabase/server'
import { getAuthUser } from '@/lib/supabase/auth-user'
import { navTabsEnabled } from '@/lib/flags'
import { resetTaste } from '@/lib/reset-taste'

export async function POST(req: NextRequest) {
  if (!navTabsEnabled()) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) {
    logAuthFailure('/api/account/start-over')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let confirm: unknown
  try {
    ({ confirm } = await req.json())
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 })
  }
  if (confirm !== 'start-over') return NextResponse.json({ error: 'not_confirmed' }, { status: 400 })

  try {
    const r = await resetTaste(user.id, { keepLists: true, keepGames: true })
    console.log(`[account/start-over] reset: DNA blank at v${r.tasteVersion}, ${r.tables} tables cleared, ${r.redisKeys} redis keys deleted`)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[account/start-over] failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'reset_failed' }, { status: 500 })
  }
}
