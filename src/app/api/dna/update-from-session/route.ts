/**
 * POST /api/dna/update-from-session
 *
 * Called by Session Brain (Assignment 1) after each conversation session ends.
 * Accepts a SessionSummary and merges it into the user's DNA fingerprint.
 *
 * Body: {
 *   ...SessionSummary fields (see src/types/dna.ts),
 *   recommendation?: RecommendationResult  // pass through when the session's
 *                                          // rec was a stretch pick, so it gets
 *                                          // recorded in learning_loop.stretch_pick_history
 * }
 *
 * ⚠️ DELIBERATELY UNCONSUMED — audited 2026-07-30, decision recorded 2026-08-26.
 * Nothing in this repo fetches this route: the live path is POST
 * /api/session/end, which calls updateSchemaFromSession() in-process (no HTTP
 * hop, no serialization round-trip). This handler is kept as the EXTERNAL
 * seam — the supported way for something outside the Next.js app to push a
 * SessionSummary. Do not delete it as dead code, and do not "fix" the
 * duplication by routing /api/session/end through it. Its response shape is a
 * superset of the agreed contract: { ok, taste_version, signal_count }.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { updateSchemaFromSession } from '@/modules/dna/update-from-session'
import type { SessionSummary, RecommendationResult } from '@/types/dna'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let summary: SessionSummary
  let recommendation: RecommendationResult | undefined
  try {
    const body = await req.json()
    summary = body
    recommendation = body.recommendation
    if (typeof summary.session_number !== 'number' || !Array.isArray(summary.new_signals)) {
      return NextResponse.json({ error: 'Invalid SessionSummary shape' }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  try {
    const updated = await updateSchemaFromSession(user.id, summary, recommendation)
    return NextResponse.json({
      ok:            true,
      taste_version: updated.metadata.taste_version,
      signal_count:  updated.signals.length,
    })
  } catch (err) {
    console.error('[dna/update-from-session]', err)
    return NextResponse.json({ error: 'DNA update failed' }, { status: 500 })
  }
}
