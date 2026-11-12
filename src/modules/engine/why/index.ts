/**
 * "Why it's a match" for one title and one user: written like a friend's
 * recommendation from facts only (write-why.ts), scored fresh so it works for
 * any title — a feed card, or a Watchlist entry saved weeks ago.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { isColdStart } from '../pipeline/cold-start'
import { getCachedRecommendations } from '../pipeline/step8-cache'
import type { ReasonPayloadWithTaste } from '../types'
import type { DNASchema } from '@/types/dna'
import { loadRatedForComparison, scoreTitlesForUser, type TitleKey } from './score-titles'
import { cacheWhy, getCachedWhy, writeWhyFromFacts, type WhyText } from './write-why'
import { cardReason } from '../pipeline/step7-card-reason'
import { cardPlots } from '../pipeline/card-plot'

export type { WhyText } from './write-why'
export type { TitleKey } from './score-titles'

/** Null when the title isn't in the catalogue or the user has no DNA. */
export async function whyForTitle(userId: string, key: TitleKey): Promise<WhyText | null> {
  const cached = await getCachedWhy(userId, key.type, key.tmdb_id).catch(() => null)
  if (cached) return cached

  const { data } = await createServiceClient()
    .from('users').select('dna').eq('id', userId)
    .single<{ dna: DNASchema | null }>()
  if (!data?.dna) return null

  const [{ items, rated }, ratedTitles, skipTasteCatch] = await Promise.all([
    scoreTitlesForUser(data.dna, [key]),
    loadRatedForComparison(data.dna),
    catchSharedInBatch(userId, data.dna.metadata.taste_version, key),
  ])
  const item = items[0]
  if (!item) return null

  const why = await writeWhyFromFacts(item, rated, isColdStart(data.dna), { dna: data.dna, ratedTitles, skipTasteCatch })
  if (why.rejected?.length) {
    console.warn(`[why] ${key.type}:${key.tmdb_id} ${why.source}: ${why.rejected.join(' | ').slice(0, 400)}`)
  }
  await cacheWhy(userId, key.type, key.tmdb_id, why).catch(() => {})
  return why
}

/**
 * Whether the title's batch marked its taste catch as one most of the batch
 * shares (step 6). The text scores the title alone, so it can't tell; the
 * batch it was served in can. Not in a cached batch (an old Watchlist entry):
 * false, and the catch is said.
 */
async function catchSharedInBatch(userId: string, tasteVersion: number, key: TitleKey): Promise<boolean> {
  const types = ['all', key.type === 'tv' ? 'series' : 'movies'] as const
  for (const contentType of types) {
    const batch = await getCachedRecommendations(userId, tasteVersion, contentType).catch(() => null)
    const hit = batch?.find(r => r.type === key.type && r.tmdb_id === key.tmdb_id)
    if (hit) return (hit.reason_payload as ReasonPayloadWithTaste).taste?.catch_shared === true
  }
  return false
}

/**
 * Fresh short card lines (facts only, no model) for titles the user saved.
 * A Watchlist entry stores the line it had when saved, and before 2026-11-06
 * that could be the AI paragraph that invented facts — so the Watchlist shows
 * these instead. Keyed `${type}:${tmdb_id}`; a title not in the catalogue is
 * absent. Null for a brand-new user: their saved lines are the popularity
 * line, which is true, and there's no taste to say anything else from.
 */
export async function cardLinesForTitles(userId: string, keys: TitleKey[]): Promise<Record<string, string> | null> {
  const { data } = await createServiceClient()
    .from('users').select('dna').eq('id', userId)
    .single<{ dna: DNASchema | null }>()
  if (!data?.dna || isColdStart(data.dna)) return null
  const { items, rated } = await scoreTitlesForUser(data.dna, keys)
  const plots = await cardPlots(items)
  return Object.fromEntries(items.map(item => [`${item.title.type}:${item.title.tmdb_id}`, cardReason(item, rated, plots)]))
}
