/**
 * POST /api/onboarding/cards — the onboarding's rating-card answers, in batches (P2-U3, docs/plan/PLAN.md).
 *
 * Body: { answers: [{ id: 'movie:157336', r: 'loved' | 'liked' | 'disliked' | 'unseen' }] }, at most 10, ids from
 * the 980 game titles (the learner cards are drawn from them).
 *
 *   - A rating goes through the same write path as a feed rating (src/lib/rating-write.ts): the DNA's
 *     recommendation_history, then the light merge into dna.signals and strand A/C, then recommendation_feedback,
 *     which My ratings reads (DEC-12).
 *   - "Haven't seen" is a play_events row, kind `card_unseen`, item_key = the title key. Not a signal: the title
 *     stays eligible for the feed.
 *   - taste_version goes up once per batch, not per card. A batch with ratings starts the first feed's build in
 *     the background (P2-U5, src/modules/engine/first-feed.ts).
 *   - The same answer sent twice writes once: history is updated in place, and a title already in
 *     recommendation_feedback is not inserted again (there is no going back on the cards, so a second row could
 *     only be a repeat).
 *
 * The client keeps unsent answers on the phone and sends them on the next visit, so a 5xx is safe to retry.
 */
import { NextRequest, NextResponse, after } from 'next/server'
import { logAuthFailure } from '@/lib/auth-guard'
import { createClient } from '@/lib/supabase/server'
import { getAuthUser } from '@/lib/supabase/auth-user'
import { createServiceClient } from '@/lib/supabase/service'
import { mergeFeedbackSignalsLight } from '@/modules/dna/merge-feedback-signal'
import { kickFirstFeed } from '@/modules/engine/first-feed'
import { FEED_START_TYPE } from '@/lib/content-type'
import { withDNAUpdate, bumpVersion } from '@/modules/dna/lib/load-save'
import { HISTORY_WRITE_ATTEMPTS, applyFeedbackToDNA } from '@/lib/rating-write'
import type { Reaction } from '@/types/dna'
import titles from '@/app/play/data/titles.json'
import { MAX_CARD_ANSWERS, type CardAnswer } from '@/app/onboarding/lib/cards'

const ANSWERS: readonly CardAnswer['r'][] = ['loved', 'liked', 'disliked', 'unseen']

let byId: Map<string, { tmdb_id: string; type: 'movie' | 'tv'; title: string }> | null = null
function gameTitle(id: string) {
  byId ??= new Map((titles as { id: string; tmdb_id: string; type: 'movie' | 'tv'; title: string }[]).map(t => [t.id, t]))
  return byId.get(id)
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) {
    logAuthFailure('/api/onboarding/cards')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let answers: CardAnswer[]
  try {
    ({ answers } = await req.json())
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 })
  }
  if (!Array.isArray(answers) || answers.length === 0 || answers.length > MAX_CARD_ANSWERS) {
    return NextResponse.json({ error: 'bad_answers' }, { status: 400 })
  }
  for (const a of answers) {
    if (!a || typeof a.id !== 'string' || !gameTitle(a.id) || !ANSWERS.includes(a.r)) {
      return NextResponse.json({ error: 'bad_answer' }, { status: 400 })
    }
  }
  // One answer per title: the last one wins (a repeat of a batch can carry the same card twice).
  const last = new Map(answers.map(a => [a.id, a]))
  const rated = [...last.values()].filter(a => a.r !== 'unseen')
  const unseen = [...last.values()].filter(a => a.r === 'unseen')

  if (rated.length) {
    const outcome = await withDNAUpdate(user.id, dna => {
      for (const a of rated) {
        const t = gameTitle(a.id)!
        applyFeedbackToDNA(dna, {
          tmdb_id: t.tmdb_id, media_type: t.type, recKey: a.id, action: 'watched',
          reaction: a.r as Reaction, is_stretch_pick: false,
        })
      }
      bumpVersion(dna)
      return true
    }, HISTORY_WRITE_ATTEMPTS)
    if (outcome === 'missing') return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    if (outcome === 'conflict') {
      console.error('[onboarding/cards] history write lost every compare-and-set; answers not recorded')
      return NextResponse.json({ error: 'Failed to save' }, { status: 409 })
    }

    await mergeFeedbackSignalsLight(user.id).catch(err =>
      console.warn('[onboarding/cards] light merge failed (non-fatal):', err instanceof Error ? err.message : err))

    const service = createServiceClient()
    const { data: have } = await service.from('recommendation_feedback').select('recommendation_id')
      .eq('user_id', user.id).in('recommendation_id', rated.map(a => a.id))
    const done = new Set((have ?? []).map(r => r.recommendation_id as string))
    const rows = rated.filter(a => !done.has(a.id))
      .map(a => ({ user_id: user.id, recommendation_id: a.id, title: gameTitle(a.id)!.title, rating: a.r }))
    if (rows.length) {
      const { error } = await service.from('recommendation_feedback').insert(rows)
      if (error) console.warn('[onboarding/cards] recommendation_feedback insert failed (non-fatal):', error.message)
    }

    // P2-U5 (Alon, #246): start building the first feed while they keep answering.
    const userId = user.id
    after(() => kickFirstFeed(userId, FEED_START_TYPE))
  }

  // A repeat (a keepalive send that landed, then the phone's copy sent again) logs a title once.
  const { data: logged } = unseen.length
    ? await supabase.from('play_events').select('item_key').eq('user_id', user.id).eq('kind', 'card_unseen')
        .in('item_key', unseen.map(a => a.id))
    : { data: [] }
  const already = new Set((logged ?? []).map(r => r.item_key as string))
  const fresh = unseen.filter(a => !already.has(a.id))
  if (fresh.length) {
    const { error } = await supabase.from('play_events').insert(
      fresh.map(a => ({ user_id: user.id, kind: 'card_unseen', item_key: a.id, payload: { source: 'onboarding' } })))
    if (error) {
      console.error('[onboarding/cards] play_events insert failed:', error.message)
      return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true, rated: rated.length, unseen: unseen.length })
}
