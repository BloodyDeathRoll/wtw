/**
 * POST /api/recommendations/survey
 *
 * Receives a deep-survey submission and updates the user's DNA fingerprint.
 * Updates strand_b dimension confidence values and strand_c aspect weights.
 *
 * Body:
 * {
 *   tmdb_id:            string
 *   dimension_ratings:  Record<string, string>           // e.g. { moral_ambiguity: "Deeply Ambiguous" }
 *   aspect_ratings:     Record<string, "good" | "ok" | "weak">
 * }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { updateSchemaFromSurvey } from '@/modules/dna/update-from-survey'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let tmdb_id: string
  let dimension_ratings: Record<string, string>
  let aspect_ratings: Record<string, 'good' | 'ok' | 'weak'>

  try {
    const body       = await req.json()
    tmdb_id          = body.tmdb_id
    dimension_ratings = body.dimension_ratings ?? {}
    aspect_ratings   = body.aspect_ratings    ?? {}

    if (!tmdb_id || typeof tmdb_id !== 'string') {
      return NextResponse.json({ error: 'tmdb_id is required' }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  try {
    await updateSchemaFromSurvey(user.id, tmdb_id, dimension_ratings, aspect_ratings)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[survey] updateSchemaFromSurvey failed:', err)
    return NextResponse.json({ error: 'Failed to update fingerprint' }, { status: 500 })
  }
}
