/**
 * POST /api/onboarding/finish — the end of the onboarding ("It's Showtime", P2-U4): makes the first feed
 * (P2-U5, Alon's `finishFirstFeed`: adopts the batch built while they answered, or bumps taste_version and
 * generates). The closing screen calls it once it has saved everything, holds itself 3 s, then opens the feed,
 * which reads the cache this leaves. An error answers 500, and the screen offers "Try again".
 */
import { NextResponse } from 'next/server'
import { logAuthFailure } from '@/lib/auth-guard'
import { createClient } from '@/lib/supabase/server'
import { getAuthUser } from '@/lib/supabase/auth-user'
import { finishFirstFeed } from '@/modules/engine/first-feed'

export const maxDuration = 60

export async function POST() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) {
    logAuthFailure('/api/onboarding/finish')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const result = await finishFirstFeed(user.id)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error('[onboarding/finish] first feed failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'first_feed_failed' }, { status: 500 })
  }
}
