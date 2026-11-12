/**
 * The first feed after onboarding (docs/plan/PLAN.md P2-U5): ready within
 * about 3 s of the last pick, because it is built while the user is still
 * answering.
 *
 *   kickFirstFeed    after each batch of card answers and after each quick
 *                    pick: build a batch in the background (precompute.ts —
 *                    one build per user at a time, a burst coalesced into one
 *                    more run, so the last answer's state is what gets parked).
 *   finishFirstFeed  after the last pick (or Skip): wait for a build still
 *                    running, then promote the parked batch as the feed for a
 *                    new taste_version (refresh-batch.ts), or, when nothing
 *                    current is parked, bump the version and generate.
 *
 * The parked batch is only adopted when everything it was built from still
 * matches, picks and genre answers included under v2 (precompute.ts
 * `outsideInputsMark`), so a batch from before the last picks never stands in
 * for the final one.
 *
 * The closing screen ("It's Showtime", P2-U4) holds itself 3 s and then shows
 * the feed through the normal GET /api/recommendations/generate, which reads
 * the cache this leaves at the new version. Nothing here knows about the 3 s.
 *
 * Callers (onboarding routes, lane U): `after(() => kickFirstFeed(userId))` in
 * the card-answers route and the pick route; `await finishFirstFeed(userId)`
 * when onboarding ends.
 */
import 'server-only'

import type { DNASchema } from '@/types/dna'
import { precomputeNextBatch, precomputeRunning } from './pipeline/precompute'
import { generateRecommendations } from './pipeline/generate'
import { refreshLiveBatch } from '@/modules/dna/refresh-batch'
import { withDNAUpdate, bumpVersion } from '@/modules/dna/lib/load-save'

/** The first feed is the mixed list; the Movies / Series toggle comes later. */
const FIRST_FEED_TYPE = 'all' as const
/** How often, and how long at most, to wait for a build the last answer started. */
const WAIT_STEP_MS = 150
const WAIT_MAX_MS = 8_000

export interface FirstFeedResult {
  taste_version: number
  /** True when the batch built during onboarding became the feed; false when it had to be generated now. */
  adopted: boolean
  /** Time spent in finishFirstFeed, for the 3 s target. */
  ms: number
}

/** Build the first feed in the background. Never throws (precompute.ts). */
export function kickFirstFeed(userId: string): Promise<void> {
  return precomputeNextBatch(userId, FIRST_FEED_TYPE)
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * Make the first feed ready at a new taste_version. Throws only when the
 * fingerprint can't be bumped or the generation itself fails; the closing
 * screen shows its "Try again" then.
 */
export async function finishFirstFeed(userId: string): Promise<FirstFeedResult> {
  const t0 = Date.now()

  // 1. The last answer usually started a build a moment ago: let it finish
  //    rather than start a second one.
  while (Date.now() - t0 < WAIT_MAX_MS && await precomputeRunning(userId)) await sleep(WAIT_STEP_MS)

  // 2. Promote it if it is current (bump + adopt + save, compare-and-set).
  const promoted = await refreshLiveBatch(userId, FIRST_FEED_TYPE)
  if (promoted != null) {
    const ms = Date.now() - t0
    console.log(`[first-feed] adopted the batch built during onboarding as v${promoted} (${ms} ms)`)
    return { taste_version: promoted, adopted: true, ms }
  }

  // 3. Nothing current was parked (a skip, an answer after the last build, a
  //    failed build): bump anyway, so the feed's cache key moves past any batch
  //    built before the last answers, and generate at the new version.
  let bumped: DNASchema | null = null
  const outcome = await withDNAUpdate(userId, dna => { bumpVersion(dna); bumped = dna; return true })
  if (outcome !== 'saved' || !bumped) throw new Error(`First feed: could not bump the fingerprint (${outcome})`)
  const dna: DNASchema = bumped
  await generateRecommendations(userId, undefined, { dna, skipCacheRead: true, contentType: FIRST_FEED_TYPE })
  const ms = Date.now() - t0
  console.log(`[first-feed] generated the first feed as v${dna.metadata.taste_version} (${ms} ms)`)
  return { taste_version: dna.metadata.taste_version, adopted: false, ms }
}
