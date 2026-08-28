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
 *   media_type:      'movie' | 'tv'   // which title the id means — TMDB movie
 *                                     // and TV ids collide (src/lib/title-key.ts)
 *   action:          'watched' | 'skipped' | 'regret' | 'glad_watched'
 *   is_stretch_pick: boolean         (default false)
 *   reaction?:       'loved' | 'liked' | 'disliked'  // when action = 'watched'
 *   title?:          string
 * }
 *
 * What each action does:
 *   watched       → marks recommendation as watched in recommendation_history
 *                   if is_stretch_pick: calls Assignment 3 updateSchemaFromStretch
 *   skipped       → marks recommendation as not accepted
 *   regret        → 48hr post-watch signal; calls Assignment 3 updateSchemaFromRegret
 *   glad_watched  → positive post-watch signal; calls Assignment 3 updateSchemaFromRegret
 *
 * History rows are written with `recommended = "type:tmdb_id"` so every later
 * reader (light merge, session fold, candidate exclusion) resolves the right
 * title. `media_type` is optional only for legacy callers (the ratings screen
 * re-rating a pre-2026-08-28 row); without it the row is matched on the bare
 * id and stored bare, exactly as before.
 */

import { NextRequest, NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { precomputeNextBatch } from '@/modules/engine/pipeline/precompute'
import { createServiceClient } from '@/lib/supabase/service'
import { isMediaType, recordMatches, titleKey, type MediaType } from '@/lib/title-key'
import { updateSchemaFromRegret } from '@/modules/dna/update-from-regret'
import { updateSchemaFromStretch } from '@/modules/dna/update-from-stretch'
import { mergeFeedbackSignalsLight } from '@/modules/dna/merge-feedback-signal'
import { invalidateDNACache } from '@/modules/dna/lib/load-save'
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
  let title: string | undefined
  let media_type: MediaType | null

  try {
    const body = await req.json()
    tmdb_id        = body.tmdb_id
    action         = body.action
    is_stretch_pick = body.is_stretch_pick ?? false
    reaction       = body.reaction
    title          = typeof body.title === 'string' ? body.title : undefined
    media_type     = isMediaType(body.media_type) ? body.media_type : null

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
  // The key this rating is filed under. Bare only for legacy callers.
  const recKey = media_type ? titleKey(media_type, tmdb_id) : tmdb_id

  // ── Update recommendation_history in DNA ──────────────────
  // Only write the row back when something in it actually changed: regret /
  // glad_watched touch nothing here, and an unconditional write of the whole
  // JSONB could clobber a concurrent card rating (this route isn't queued for
  // the regret prompt).
  let dnaChanged = false
  const history = dna.learning_loop.recommendation_history
  const entryIndex = history.findLastIndex(h => recordMatches(h, tmdb_id, media_type))

  if (entryIndex >= 0) {
    const entry = history[entryIndex]

    if (action === 'watched') {
      history[entryIndex] = {
        ...entry,
        // Upgrade a legacy bare row to the composite key now that we know it
        recommended: media_type ? recKey : entry.recommended,
        accepted: true,
        watched: true,
        rating: reaction ?? null,
      }
      dnaChanged = true
    } else if (action === 'skipped') {
      // Keep the reaction — a "Don't like" is a negative fingerprint signal,
      // not just a decline. Dropping it here made dislikes vanish entirely.
      history[entryIndex] = {
        ...entry,
        recommended: media_type ? recKey : entry.recommended,
        accepted: false,
        rating: reaction ?? entry.rating ?? null,
      }
      dnaChanged = true
    }
    // 'regret' and 'glad_watched' update regret_signal, handled by Assignment 3 below
  } else if (action === 'watched' || action === 'skipped') {
    // Recommendation wasn't in history yet (e.g. served from the rec cache,
    // which doesn't append history entries). Record it either way — the
    // session-end fold converts rated entries into DNA signals.
    history.push({
      session:             dna.metadata.total_sessions,
      recommended:         recKey,
      tmdb_id,
      accepted:            action === 'watched',
      watched:             action === 'watched',
      rating:              reaction ?? null,
      fingerprint_version: dna.metadata.taste_version,
    })
    dnaChanged = true
  }

  // Also update stretch_pick_history if applicable
  if (is_stretch_pick && (action === 'watched' || action === 'skipped')) {
    const stretchEntry = dna.learning_loop.stretch_pick_history
      .find(s => s.tmdb_id === tmdb_id)

    if (stretchEntry) {
      stretchEntry.accepted  = action === 'watched'
      stretchEntry.reaction  = reaction ?? null
      dnaChanged = true
    }
  }

  // ── Persist updated DNA ───────────────────────────────────
  if (dnaChanged) {
    const { error: updateError } = await serviceClient
      .from('users')
      .update({ dna, updated_at: new Date().toISOString() })
      .eq('id', user.id)

    if (updateError) {
      console.error('[recommendations/feedback] DNA update failed:', updateError.message)
      return NextResponse.json({ error: 'Failed to save feedback' }, { status: 500 })
    }

    // The write above bypassed saveDNA, so bust the 60s loadDNA cache BEFORE the
    // hooks below — they all read via cache-first loadDNA. Without this, a
    // rating within 60s of the on-load warm-up (which populates the cache) made
    // the light merge read a stale snapshot: usually a silent no-op, worst case
    // saving the stale object back over this request's own write.
    await invalidateDNACache(user.id)
  }

  // ── Incremental fingerprint update (cheap, no version bump) ─
  // Fold this rating into DNA signals + strand A/C NOW, so by the time the
  // user hits "Find more" most of the fingerprint work is already done and
  // session-end only bumps the version + regenerates. No bump here keeps the
  // rec cache the user is scrolling valid. The UI serializes feedback clicks,
  // so these read-modify-writes don't race.
  if (reaction) {
    await mergeFeedbackSignalsLight(user.id).catch(err =>
      console.warn('[feedback] light merge failed (non-fatal):', err instanceof Error ? err.message : err)
    )
    // The fingerprint inputs are final for this rating — build the next batch
    // now, after the response, so "Find more" only has to adopt it
    // (precompute.ts coalesces bursts; never throws).
    const userId = user.id
    after(() => precomputeNextBatch(userId))
  }

  // ── Log to recommendation_feedback (best-effort) ──────────
  // The raw reaction stream: welcome.ts counts these rows for the maturity
  // heuristic and the DNA Writer's documented inputs include this table.
  // Migration 0013 narrowed the rating constraint to loved / liked / disliked
  // (the "mixed" level was dropped; see the Reaction enum in src/types/dna.ts).
  if (reaction) {
    await serviceClient.from('recommendation_feedback').insert({
      user_id: user.id,
      recommendation_id: recKey,
      title: title ?? null,
      rating: reaction,
    }).then(({ error }) => {
      if (error) console.warn('[feedback] recommendation_feedback insert failed (non-fatal):', error.message)
    })
  }

  // ── DNA Writer hooks ──────────────────────────────────────
  if (action === 'regret' || action === 'glad_watched') {
    const regretSignal = action === 'regret' ? 'regret' : 'glad_watched'
    await updateSchemaFromRegret(user.id, tmdb_id, regretSignal, media_type).catch(err =>
      console.error('[feedback] updateSchemaFromRegret failed:', err)
    )
  }

  if (is_stretch_pick && action === 'watched' && reaction) {
    await updateSchemaFromStretch(user.id, tmdb_id, reaction, media_type).catch(err =>
      console.error('[feedback] updateSchemaFromStretch failed:', err)
    )
  }

  return NextResponse.json({ ok: true })
}
