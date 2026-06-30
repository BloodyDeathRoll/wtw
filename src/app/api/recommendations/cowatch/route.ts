/**
 * POST /api/recommendations/cowatch
 *
 * Generates co-watch recommendations for two users in a room.
 * The authenticated user is User A. User B is identified by their user_id.
 *
 * Body:
 * {
 *   room_code: string    // 4-digit code identifying the co-watch session
 *   user_id_b: string    // Supabase user ID of the second viewer
 * }
 *
 * Response: CowatchResult[]
 *
 * Scores both users independently (Steps 1–3), then merges by geometric mean.
 * Cached in Redis keyed by room_code + both taste_versions.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateCowatchRecommendations } from '@/modules/engine'

export async function POST(req: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Parse body ────────────────────────────────────────────
  let room_code: string
  let user_id_b: string

  try {
    const body = await req.json()
    room_code = body.room_code
    user_id_b = body.user_id_b

    if (!room_code || typeof room_code !== 'string') {
      return NextResponse.json({ error: 'room_code is required' }, { status: 400 })
    }
    if (!user_id_b || typeof user_id_b !== 'string') {
      return NextResponse.json({ error: 'user_id_b is required' }, { status: 400 })
    }
    if (user_id_b === user.id) {
      return NextResponse.json({ error: 'Cannot co-watch with yourself' }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

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
