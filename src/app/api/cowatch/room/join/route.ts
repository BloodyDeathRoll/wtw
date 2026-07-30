/**
 * POST /api/cowatch/room/join — claim the guest slot in a room.
 *
 * Body: { code: string }   // the 4 digits the host read out
 * Response: { code, expires_at }
 *
 * Joining is what makes a co-watch intersection legal: until both slots are
 * filled, POST /api/recommendations/cowatch has no partner to score against and
 * refuses. Codes are short and guessable by design, so the blast radius of a
 * guessed code is deliberately small — a joiner can only ever pair their OWN
 * fingerprint with the host's, and the host has to be actively hosting.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export const runtime = 'nodejs'

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
  // two people racing for the last slot can't both win.
  const { data: claimed, error: claimError } = await db
    .from('cowatch_rooms')
    .update({ guest_id: user.id })
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
