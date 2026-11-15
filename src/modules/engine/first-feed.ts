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

import { after } from 'next/server'
import type { DNASchema } from '@/types/dna'
import { FEED_START_TYPE, type ContentType } from '@/lib/content-type'
import { precomputeNextBatch, precomputeRunning } from './pipeline/precompute'
import { generateRecommendations, INLINE_PLOT_WAIT_MS } from './pipeline/generate'
import { refreshLiveBatch } from '@/modules/dna/refresh-batch'
import { withDNAUpdate, bumpVersion } from '@/modules/dna/lib/load-save'
import { getRedis } from '@/lib/redis'

/**
 * The list the first feed is built for: the one the feed opens on
 * (FEED_START_TYPE, which WTWApp starts on and the onboarding routes pass).
 * One constant, so the two can't drift apart again (#307 and #308 crossed on
 * 2026-11-13; #311 joined them).
 */
export const FIRST_FEED_TYPE: ContentType = FEED_START_TYPE
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

/**
 * Build the first feed in the background. Never throws (precompute.ts). It is
 * a build someone will wait on, so it doesn't wait for NEW plot summaries
 * (a new user has none cached; 2.5 s each build made "It's Showtime" ~10 s):
 * they finish in the background, and a card without one keeps its fact line.
 */
export function kickFirstFeed(userId: string, contentType: ContentType = FIRST_FEED_TYPE): Promise<void> {
  return precomputeNextBatch(userId, contentType, undefined, { plotWaitMs: INLINE_PLOT_WAIT_MS })
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// ─────────────────────────────────────────────
// Timing log (#246)
// ─────────────────────────────────────────────

/**
 * Every finishFirstFeed, newest first, the last 50: how long it took, how much
 * of that was waiting for a build still running, and whether the onboarding
 * batch was adopted. In Redis because Vercel's Hobby plan keeps runtime logs
 * for an hour, and a test run is usually read later than that (#246, Eran's
 * run of 2026-11-14 15:19 UTC). No user id. Read with `npm run budget-check`.
 */
export const FIRST_FEED_TIMINGS_KEY = 'first_feed:timings'
const TIMINGS_KEEP = 50

export interface FirstFeedTiming {
  at: string          // ISO, when finishFirstFeed returned or threw
  ms: number          // all of finishFirstFeed
  waited_ms: number   // of which: waiting for a build the last answer started
  adopted: boolean
  error?: string
}

/** Best-effort: a logging failure must never fail the first feed. */
async function recordTiming(t: FirstFeedTiming): Promise<void> {
  try {
    const redis = getRedis()
    await redis.lpush(FIRST_FEED_TIMINGS_KEY, JSON.stringify(t))
    await redis.ltrim(FIRST_FEED_TIMINGS_KEY, 0, TIMINGS_KEEP - 1)
  } catch (e) {
    console.warn('[first-feed] could not record timing:', e instanceof Error ? e.message : e)
  }
}

/** After the response when there is one (the user isn't kept waiting on Redis); right away in a script or test. */
function afterResponse(task: () => Promise<void>): void {
  try { after(task) } catch { void task() }
}

/** The recorded timings, newest first; a corrupt row is skipped. */
export async function firstFeedTimings(limit = TIMINGS_KEEP): Promise<FirstFeedTiming[]> {
  const rows = await getRedis().lrange<FirstFeedTiming | string>(FIRST_FEED_TIMINGS_KEY, 0, limit - 1)
  const out: FirstFeedTiming[] = []
  for (const r of rows) {
    try {
      const t = typeof r === 'string' ? (JSON.parse(r) as FirstFeedTiming) : r
      if (t && typeof t.at === 'string' && typeof t.ms === 'number') out.push(t)
    } catch {
      // skip
    }
  }
  return out
}

/**
 * Make the first feed ready at a new taste_version. Throws only when the
 * fingerprint can't be bumped or the generation itself fails; the closing
 * screen shows its "Try again" then.
 */
export async function finishFirstFeed(userId: string, contentType: ContentType = FIRST_FEED_TYPE): Promise<FirstFeedResult> {
  const t0 = Date.now()
  const waited = { ms: 0 }
  try {
    const result = await finish(userId, contentType, t0, waited)
    afterResponse(() => recordTiming({ at: new Date().toISOString(), ms: result.ms, waited_ms: waited.ms, adopted: result.adopted }))
    return result
  } catch (err) {
    const t = { at: new Date().toISOString(), ms: Date.now() - t0, waited_ms: waited.ms, adopted: false, error: err instanceof Error ? err.message : String(err) }
    afterResponse(() => recordTiming(t))
    throw err
  }
}

async function finish(userId: string, contentType: ContentType, t0: number, waited: { ms: number }): Promise<FirstFeedResult> {
  // 1. The last answer usually started a build a moment ago: let it finish
  //    rather than start a second one.
  while (Date.now() - t0 < WAIT_MAX_MS && await precomputeRunning(userId)) await sleep(WAIT_STEP_MS)
  waited.ms = Date.now() - t0

  // 2. Promote it if it is current (bump + adopt + save, compare-and-set).
  const promoted = await refreshLiveBatch(userId, contentType)
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
  await generateRecommendations(userId, undefined, { dna, skipCacheRead: true, contentType })
  const ms = Date.now() - t0
  console.log(`[first-feed] generated the first feed as v${dna.metadata.taste_version} (${ms} ms)`)
  return { taste_version: dna.metadata.taste_version, adopted: false, ms }
}
