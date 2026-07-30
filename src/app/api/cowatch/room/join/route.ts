/**
 * POST /api/cowatch/room/join — claim the guest slot in a room.
 *
 * Body: { code: string }   // the 4 digits the host read out
 * Response: { code, expires_at }
 *
 * Joining is what makes a co-watch intersection legal: until both slots are
 * filled, POST /api/recommendations/cowatch has no partner to score against and
 * refuses.
 *
 * Codes are only 4 digits, so the whole space is ~10,000 guesses and joining is
 * NOT a low-stakes action: a member receives co-watch explanations that describe
 * the other person's taste in prose. The defence is time, not entropy — a room
 * is joinable for 5 minutes (migration 0015), which is about as long as it takes
 * to read the digits out loud. Claiming the slot extends it to the full session
 * length below, so the pair aren't rushed once they're actually paired.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export const runtime = 'nodejs'

// How long a room lives once both viewers are in it. The short unclaimed window
// only has to cover reading the code out loud; a paired session needs an evening.
const SESSION_MS = 2 * 60 * 60 * 1000

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const code = typeof body.code === 'string' ? body.code.trim() : null
  if (!code || !/^\d{4}$/.test(code)) {
    return NextResponse.json({ error: 'A 4-digit code is required' }, { status: 400 })
  }

  const db = createServiceClient()
  const { data: room, error } = await db
    .from('cowatch_rooms')
    .select('code, host_id, guest_id, expires_at')
    .eq('code', code)
    .maybeSingle<{ code: string; host_id: string; guest_id: string | null; expires_at: string }>()

  if (error) {
    console.error('[cowatch/room/join] lookup failed:', error.message)
    return NextResponse.json({ error: 'Failed to join the room' }, { status: 500 })
  }
  // Same response for "no such room" and "expired room": don't confirm which
  // codes exist to someone dialling digits.
  if (!room || new Date(room.expires_at) <= new Date()) {
    return NextResponse.json({ error: 'That room is not available' }, { status: 404 })
  }
  if (room.host_id === user.id) {
    return NextResponse.json({ error: 'You are hosting this room' }, { status: 409 })
  }
  // Already in it — idempotent, so a double-tap doesn't error.
  if (room.guest_id === user.id) {
    return NextResponse.json({ code: room.code, expires_at: room.expires_at })
  }
  if (room.guest_id != null) {
    return NextResponse.json({ error: 'That room is full' }, { status: 409 })
  }

  // Conditional update: `is('guest_id', null)` makes this a compare-and-set, so
  // two people racing for the last slot can't both win. Claiming also lifts the
  // room off the short unclaimed window onto a full session.
  const { data: claimed, error: claimError } = await db
    .from('cowatch_rooms')
    .update({
      guest_id: user.id,
      expires_at: new Date(Date.now() + SESSION_MS).toISOString(),
    })
    .eq('code', code)
    .is('guest_id', null)
    .select('code, expires_at')
    .maybeSingle<{ code: string; expires_at: string }>()

  if (claimError) {
    console.error('[cowatch/room/join] claim failed:', claimError.message)
    return NextResponse.json({ error: 'Failed to join the room' }, { status: 500 })
  }
  if (!claimed) {
    return NextResponse.json({ error: 'That room is full' }, { status: 409 })
  }

  return NextResponse.json({ code: claimed.code, expires_at: claimed.expires_at })
}
