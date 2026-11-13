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
 *   content_type?:   'movies' | 'series' | 'all'  // the list the user is on — the
 *                                     // batch the rating rebuilds. Defaults from
 *                                     // media_type, never to 'all' when the
 *                                     // title's type is known.
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
import { logAuthFailure } from '@/lib/auth-guard'
import { createClient } from '@/lib/supabase/server'
import { getAuthUser } from '@/lib/supabase/auth-user'
import { precomputeNextBatch } from '@/modules/engine/pipeline/precompute'
import { createServiceClient } from '@/lib/supabase/service'
import { isMediaType, titleKey, type MediaType } from '@/lib/title-key'
import { isContentType, type ContentType } from '@/lib/content-type'
import { updateSchemaFromRegret } from '@/modules/dna/update-from-regret'
import { updateSchemaFromStretch } from '@/modules/dna/update-from-stretch'
import { unrateTitle } from '@/modules/dna/unrate'
import { mergeFeedbackSignalsLight } from '@/modules/dna/merge-feedback-signal'
import { countRatingTowardRefresh, refreshIfDue } from '@/modules/dna/refresh-batch'
import { withDNAUpdate } from '@/modules/dna/lib/load-save'
import type { Reaction } from '@/types/dna'
import { VALID_ACTIONS, VALID_REACTIONS, HISTORY_WRITE_ATTEMPTS, applyFeedbackToDNA, type FeedbackAction } from '@/lib/rating-write'

export async function POST(req: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────
  const supabase = await createClient()
  const user = await getAuthUser(supabase)

  if (!user) {
    logAuthFailure('/api/recommendations/feedback')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Parse + validate body ─────────────────────────────────
  let tmdb_id: string
  let action: FeedbackAction
  let is_stretch_pick: boolean
  let reaction: Reaction | undefined
  let title: string | undefined
  let media_type: MediaType | null
  // Which list the rating came from, so the precomputed next batch matches it.
  let contentType: ContentType

  try {
    const body = await req.json()
    tmdb_id        = body.tmdb_id
    action         = body.action
    is_stretch_pick = body.is_stretch_pick ?? false
    reaction       = body.reaction ?? undefined
    title          = typeof body.title === 'string' ? body.title : undefined
    media_type     = isMediaType(body.media_type) ? body.media_type : null
    // A caller that omits content_type used to get 'all': a full precompute
    // for a batch no list adopts, and on the 5th rating a promotion with no
    // movies/series cache behind it (Dream 2026-10-06). The title's own type
    // is the next best guess at the list the user is on.
    contentType    = isContentType(body.content_type) ? body.content_type
                   : media_type === 'movie' ? 'movies'
                   : media_type === 'tv' ? 'series'
                   : 'all'

    if (!tmdb_id || typeof tmdb_id !== 'string') {
      return NextResponse.json({ error: 'tmdb_id is required' }, { status: 400 })
    }
    if (!VALID_ACTIONS.includes(action)) {
      return NextResponse.json(
        { error: `action must be one of: ${VALID_ACTIONS.join(', ')}` },
        { status: 400 }
      )
    }
    if (reaction !== undefined && !VALID_REACTIONS.includes(reaction)) {
      return NextResponse.json(
        { error: `reaction must be one of: ${VALID_REACTIONS.join(', ')}` },
        { status: 400 }
      )
    }
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const serviceClient = createServiceClient()

  // The key this rating is filed under. Bare only for legacy callers.
  const recKey = media_type ? titleKey(media_type, tmdb_id) : tmdb_id

  // ── Update recommendation_history in DNA ──────────────────
  // Read-modify-write under a compare-and-set, retried once against a fresh
  // read (2026-09-20). `users.dna` is one JSONB column and this is no longer
  // the only writer in flight: refreshLiveBatch writes it from `after()`,
  // seconds after its own request returned. A blind write here would
  // unconditionally restore the pre-refresh snapshot — reverting the version
  // bump and putting the feed back on a batch with nothing cached under it,
  // which is the exact failure the refresh exists to prevent.
  //
  // More attempts than the default, because this write has no backstop: the
  // session-end fold recovers a rating from `recommendation_history`, so if
  // THIS is what failed to land there is nothing left to recover from — and
  // the client only logs a failed POST, having already shown the card as
  // rated. Every other writer of this column can afford to give up.
  const outcome = await withDNAUpdate(
    user.id,
    dna => applyFeedbackToDNA(dna, { tmdb_id, media_type, recKey, action, reaction, is_stretch_pick }),
    HISTORY_WRITE_ATTEMPTS,
  )
  if (outcome === 'missing') {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }
  if (outcome === 'conflict') {
    // Nothing recorded this rating anywhere. Say so with a status the client
    // can act on rather than pretending it landed.
    console.error(`[feedback] history write lost ${HISTORY_WRITE_ATTEMPTS} races; rating not recorded`)
    return NextResponse.json({ error: 'Failed to save feedback' }, { status: 409 })
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
    //
    // Every Nth rating that parked batch is also promoted to the LIVE cache
    // under a bumped version, so a run of dislikes reaches the feed in the
    // same sitting instead of waiting for "Find more" (refresh-batch.ts). The
    // promotion runs from INSIDE the precompute, right after a park — not
    // beside it from here: when a build for an earlier rating is still
    // running, this call only flags it dirty and returns, and a refresh run
    // at that point found nothing parked (or a batch built before this
    // rating) and was skipped until the next Nth rating.
    const userId = user.id
    after(async () => {
      // Counted here, off the request path; it only has to land before the park.
      await countRatingTowardRefresh(userId)
      await precomputeNextBatch(userId, contentType, () => refreshIfDue(userId, contentType))
    })
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

/**
 * DELETE /api/recommendations/feedback — take a card rating back (the user
 * tapped the lit Loved / Liked / Disliked chip again).
 *
 * Body: { tmdb_id, media_type?, content_type?, saved? }. `saved` says the title
 * is on the user's Watchlist, so its history entry returns to the saved marker.
 *
 * Undoes the rating in the fingerprint (unrateTitle) and drops it from the
 * Ratings page (its recommendation_feedback rows). Then the next batch is
 * rebuilt in the background against the corrected fingerprint, like a rating.
 */
export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) {
    logAuthFailure('/api/recommendations/feedback')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let tmdb_id: string
  let media_type: MediaType | null
  let contentType: ContentType
  let saved: boolean
  try {
    const body = await req.json()
    tmdb_id     = body.tmdb_id
    media_type  = isMediaType(body.media_type) ? body.media_type : null
    saved       = body.saved === true
    contentType = isContentType(body.content_type) ? body.content_type
                : media_type === 'movie' ? 'movies'
                : media_type === 'tv' ? 'series'
                : 'all'
    if (!tmdb_id || typeof tmdb_id !== 'string') {
      return NextResponse.json({ error: 'tmdb_id is required' }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const outcome = await unrateTitle(user.id, { tmdb_id, media_type, saved })
  if (outcome === 'missing') {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }
  if (outcome === 'conflict') {
    console.error('[feedback] un-rate lost every compare-and-set; not recorded')
    return NextResponse.json({ error: 'Failed to clear rating' }, { status: 409 })
  }

  // The Ratings page reads these rows. A typed key only matches its own title;
  // a bare id is matched only when the caller can't say which title it is.
  const recKey = media_type ? titleKey(media_type, tmdb_id) : tmdb_id
  const { error } = await createServiceClient()
    .from('recommendation_feedback')
    .delete()
    .eq('user_id', user.id)
    .eq('recommendation_id', recKey)
  if (error) {
    console.error('[feedback] recommendation_feedback delete failed:', error.message)
    return NextResponse.json({ error: 'Failed to clear rating' }, { status: 500 })
  }

  if (outcome === 'saved') {
    const userId = user.id
    after(async () => {
      await precomputeNextBatch(userId, contentType)
    })
  }

  return NextResponse.json({ ok: true })
}
