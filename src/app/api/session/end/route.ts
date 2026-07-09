/**
 * POST /api/session/end
 *
 * The Session Brain's end-of-conversation hook. Given a conversation_id it:
 *   1. loads the transcript (ownership-checked),
 *   2. ensures the user has a DNA fingerprint (bootstraps a blank one if not),
 *   3. analyzes the transcript into a SessionSummary (real DNASignals),
 *   4. merges it into the fingerprint via the DNA Writer (bumps taste_version),
 *   5. runs the recommendation engine, which caches fresh recs in Redis.
 *
 * After this returns, GET /api/recommendations/generate serves live,
 * poster-bearing recommendations (source: "cache") instead of mocks.
 *
 * Body: { conversation_id: string }
 * Response: { ok, taste_version, signal_count, rec_count }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createBlankDNA } from '@/modules/dna/blank-dna'
import { updateSchemaFromSession } from '@/modules/dna/update-from-session'
import { generateRecommendations } from '@/modules/engine'
import { analyzeSession } from '@/modules/session/analyze-session'
import type { DNASchema } from '@/types/dna'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const conversationId: string | undefined = body.conversation_id
  if (!conversationId) {
    return NextResponse.json({ error: 'conversation_id required' }, { status: 400 })
  }

  const db = createServiceClient()

  // ── 1. Load conversation (ownership check) + transcript ──────
  const { data: convo } = await db
    .from('conversations')
    .select('id, user_id')
    .eq('id', conversationId)
    .single<{ id: string; user_id: string }>()

  if (!convo || convo.user_id !== user.id) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
  }

  const { data: messages } = await db
    .from('messages')
    .select('role, content')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })

  // ── 2. Ensure a DNA fingerprint exists (idempotent bootstrap) ─
  const { data: userRow } = await db
    .from('users')
    .select('dna')
    .eq('id', user.id)
    .single<{ dna: DNASchema | null }>()

  let dna = userRow?.dna ?? null
  if (!dna) {
    dna = createBlankDNA(user.id)
    await db
      .from('users')
      .update({ dna, updated_at: new Date().toISOString() })
      .eq('id', user.id)
  }

  const sessionNumber = (dna.metadata.total_sessions ?? 0) + 1

  // ── 3. Transcript → SessionSummary (real signals) ────────────
  const summary = await analyzeSession(messages ?? [], sessionNumber)

  // ── 4. Merge into the fingerprint (bumps taste_version) ──────
  let taste_version: number
  try {
    const updated = await updateSchemaFromSession(user.id, summary)
    taste_version = updated.metadata.taste_version
  } catch (err) {
    console.error('[session/end] DNA update failed:', err)
    return NextResponse.json({ error: 'Fingerprint update failed' }, { status: 500 })
  }

  // ── 5. Generate + cache real recommendations ─────────────────
  let rec_count = 0
  try {
    const recs = await generateRecommendations(user.id)
    rec_count = recs.length
  } catch (err) {
    // Fingerprint is saved; recs can be regenerated on next visit.
    console.error('[session/end] recommendation generation failed:', err)
    return NextResponse.json({
      ok: true,
      taste_version,
      signal_count: summary.new_signals.length,
      rec_count: 0,
      warning: 'Fingerprint updated but recommendation generation failed',
    })
  }

  return NextResponse.json({
    ok: true,
    taste_version,
    signal_count: summary.new_signals.length,
    rec_count,
  })
}
