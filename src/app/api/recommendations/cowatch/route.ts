/**
 * POST /api/recommendations/cowatch
 *
 * Generates co-watch recommendations for the two members of a room. The
 * authenticated caller is User A; User B is whoever else is in the room.
 *
 * Body:
 * {
 *   room_code: string    // 4-digit code identifying the co-watch session
 * }
 *
 * Response: CowatchResult[]
 *
 * Scores both users independently (Steps 1–3), then merges by geometric mean.
 * Cached in Redis keyed by room_code + both taste_versions.
 *
 * SECURITY — this route used to take `user_id_b` from the request body and hand
 * it to the engine, which loads that user's DNA with the service-role client
 * (bypassing RLS). `room_code` was never checked against anything; it only ever
 * seeded the Redis cache key. Any authenticated user could therefore read any
 * other user's taste profile by guessing a user id.
 *
 * The fix is structural rather than a validation bolt-on: the partner is now
 * DERIVED from room membership (see migration 0015 / POST /api/cowatch/room), so
 * there is no client-supplied user id left to abuse. A caller who is not a member
 * of the room gets 403 and no information about who is.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { resolvePartner, type CowatchRoomRow } from '@/lib/cowatch-room'
import { generateCowatchRecommendations } from '@/modules/engine'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Parse body ────────────────────────────────────────────
  const body = await req.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const room_code = typeof body.room_code === 'string' ? body.room_code.trim() : null
  if (!room_code || !/^\d{4}$/.test(room_code)) {
    return NextResponse.json({ error: 'A 4-digit room_code is required' }, { status: 400 })
  }

  // ── Authorise via room membership ─────────────────────────
  // Service-role read: a room has to be looked up by code before we can know
  // whether the caller belongs to it, which RLS can't express.
  const db = createServiceClient()
  const { data: room, error: roomError } = await db
    .from('cowatch_rooms')
    .select('host_id, guest_id, expires_at')
    .eq('code', room_code)
    .maybeSingle<CowatchRoomRow>()

  if (roomError) {
    console.error('[recommendations/cowatch] room lookup failed:', roomError.message)
    return NextResponse.json({ error: 'Failed to generate co-watch recommendations' }, { status: 500 })
  }

  // One response for "no such room", "expired", and "not your room". A non-member
  // must learn nothing — not even whether the code is live.
  const resolved = resolvePartner(room, user.id, new Date())
  if (resolved.status === 'denied') {
    return NextResponse.json({ error: 'That room is not available' }, { status: 403 })
  }
  if (resolved.status === 'waiting') {
    return NextResponse.json(
      { error: 'Waiting for the other viewer to join' },
      { status: 409 },
    )
  }
  const user_id_b = resolved.partnerId

  // ── Run co-watch pipeline ─────────────────────────────────
  try {
    const results = await generateCowatchRecommendations(user.id, user_id_b, room_code)
    return NextResponse.json(results)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[recommendations/cowatch]', message)

    if (message.includes('Could not load DNA')) {
      return NextResponse.json(
        { error: 'One or both users have not completed onboarding.' },
        { status: 404 }
      )
    }

    return NextResponse.json({ error: 'Failed to generate co-watch recommendations' }, { status: 500 })
  }
}
