/**
 * POST /api/recommendations/feedback
 *
 * Logs user feedback on a recommendation and updates the DNA accordingly.
 * This is the bridge between the engine (Assignment 2) and the DNA Writer
 * (Assignment 3). When Assignment 3 is available, it handles the deep
 * schema updates; this route handles the lightweight logging and handoff.
 *
 * Body:
 * {
 *   tmdb_id:         string
 *   action:          'watched' | 'skipped' | 'regret' | 'glad_watched'
 *   is_stretch_pick: boolean         (default false)
 *   reaction?:       'loved' | 'liked' | 'mixed' | 'disliked'  // when action = 'watched'
 * }
 *
 * What each action does:
 *   watched       → marks recommendation as watched in recommendation_history
 *                   if is_stretch_pick: calls Assignment 3 updateSchemaFromStretch
 *   skipped       → marks recommendation as not accepted
 *   regret        → 48hr post-watch signal; calls Assignment 3 updateSchemaFromRegret
 *   glad_watched  → positive post-watch signal; calls Assignment 3 updateSchemaFromRegret
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { updateSchemaFromRegret } from '@/modules/dna/update-from-regret'
import { updateSchemaFromStretch } from '@/modules/dna/update-from-stretch'
import type { DNASchema, Reaction } from '@/types/dna'

const VALID_ACTIONS = ['watched', 'skipped', 'regret', 'glad_watched'] as const
type FeedbackAction = typeof VALID_ACTIONS[number]

export async function POST(req: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Parse + validate body ─────────────────────────────────
  let tmdb_id: string
  let action: FeedbackAction
  let is_stretch_pick: boolean
  let reaction: Reaction | undefined

  try {
    const body = await req.json()
    tmdb_id        = body.tmdb_id
    action         = body.action
    is_stretch_pick = body.is_stretch_pick ?? false
    reaction       = body.reaction

    if (!tmdb_id || typeof tmdb_id !== 'string') {
      return NextResponse.json({ error: 'tmdb_id is required' }, { status: 400 })
    }
    if (!VALID_ACTIONS.includes(action)) {
      return NextResponse.json(
        { error: `action must be one of: ${VALID_ACTIONS.join(', ')}` },
        { status: 400 }
      )
    }
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const serviceClient = createServiceClient()

  // ── Load current DNA ──────────────────────────────────────
  const { data: userData, error: loadError } = await serviceClient
    .from('users')
    .select('dna')
    .eq('id', user.id)
    .single<{ dna: DNASchema | null }>()

  if (loadError || !userData?.dna) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }

  const dna = userData.dna

  // ── Update recommendation_history in DNA ──────────────────
  const history = dna.learning_loop.recommendation_history
  const entryIndex = history.findLastIndex(h => h.tmdb_id === tmdb_id)

  if (entryIndex >= 0) {
    const entry = history[entryIndex]

    if (action === 'watched') {
      history[entryIndex] = {
        ...entry,
        accepted: true,
        watched: true,
        rating: reaction ?? null,
      }
    } else if (action === 'skipped') {
      history[entryIndex] = { ...entry, accepted: false }
    }
    // 'regret' and 'glad_watched' update regret_signal, handled by Assignment 3 below
  } else if (action === 'watched') {
    // Recommendation wasn't in history yet (e.g. user found it through browsing)
    history.push({
      session:             dna.metadata.total_sessions,
      recommended:         tmdb_id,
      tmdb_id,
      accepted:            true,
      watched:             true,
      rating:              reaction ?? null,
      fingerprint_version: dna.metadata.taste_version,
    })
  }

  // Also update stretch_pick_history if applicable
  if (is_stretch_pick && (action === 'watched' || action === 'skipped')) {
    const stretchEntry = dna.learning_loop.stretch_pick_history
      .find(s => s.tmdb_id === tmdb_id)

    if (stretchEntry) {
      stretchEntry.accepted  = action === 'watched'
      stretchEntry.reaction  = reaction ?? null
    }
  }

  // ── Persist updated DNA ───────────────────────────────────
  const { error: updateError } = await serviceClient
    .from('users')
    .update({ dna, updated_at: new Date().toISOString() })
    .eq('id', user.id)

  if (updateError) {
    console.error('[recommendations/feedback] DNA update failed:', updateError.message)
    return NextResponse.json({ error: 'Failed to save feedback' }, { status: 500 })
  }

  // ── DNA Writer hooks ──────────────────────────────────────
  if (action === 'regret' || action === 'glad_watched') {
    const regretSignal = action === 'regret' ? 'regret' : 'glad_watched'
    await updateSchemaFromRegret(user.id, tmdb_id, regretSignal).catch(err =>
      console.error('[feedback] updateSchemaFromRegret failed:', err)
    )
  }

  if (is_stretch_pick && action === 'watched' && reaction) {
    await updateSchemaFromStretch(user.id, tmdb_id, reaction).catch(err =>
      console.error('[feedback] updateSchemaFromStretch failed:', err)
    )
  }

  return NextResponse.json({ ok: true })
}
