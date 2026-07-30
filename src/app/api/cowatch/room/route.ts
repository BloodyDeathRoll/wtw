/**
 * POST /api/cowatch/room — open a co-watch room as the host.
 * GET  /api/cowatch/room — the caller's live room, if any.
 *
 * The 4-digit code is what the two viewers share out loud. Membership recorded
 * here is the ONLY thing that authorises a co-watch fingerprint intersection —
 * see POST /api/recommendations/cowatch, which derives the partner from the room
 * rather than trusting a user id from the request body.
 *
 * Response (POST): { code, expires_at }
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export const runtime = 'nodejs'

const CODE_ATTEMPTS = 8

function randomCode(): string {
  return String(Math.floor(Math.random() * 10000)).padStart(4, '0')
}

export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const db = createServiceClient()

  // Expired rooms hold their codes hostage — only 10,000 exist. Purge first so
  // a stale room from hours ago can't crowd out a new one.
  await db.from('cowatch_rooms').delete().lt('expires_at', new Date().toISOString())

  // One live room per host: re-opening replaces it rather than leaking rooms.
  await db.from('cowatch_rooms').delete().eq('host_id', user.id)

  for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
    const code = randomCode()
    const { data, error } = await db
      .from('cowatch_rooms')
      .insert({ code, host_id: user.id })
      .select('code, expires_at')
      .single<{ code: string; expires_at: string }>()

    if (!error && data) {
      return NextResponse.json({ code: data.code, expires_at: data.expires_at })
    }
    // 23505 = unique violation: that code is taken by another live room. Any
    // other error is real and shouldn't be retried.
    if (error && error.code !== '23505') {
      console.error('[cowatch/room] create failed:', error.message)
      return NextResponse.json({ error: 'Failed to open a room' }, { status: 500 })
    }
  }

  // Every attempt collided — the code space is genuinely busy right now.
  return NextResponse.json(
    { error: 'Could not allocate a room code, try again' },
    { status: 503 },
  )
}

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const db = createServiceClient()
  const { data } = await db
    .from('cowatch_rooms')
    .select('code, host_id, guest_id, expires_at')
    .or(`host_id.eq.${user.id},guest_id.eq.${user.id}`)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ code: string; host_id: string; guest_id: string | null; expires_at: string }>()

  if (!data) return NextResponse.json({ room: null })

  return NextResponse.json({
    room: {
      code: data.code,
      expires_at: data.expires_at,
      is_host: data.host_id === user.id,
      has_partner: data.guest_id != null,
    },
  })
}
