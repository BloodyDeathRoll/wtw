/**
 * precompute — build the next batch while the user is still rating.
 *
 * "Find more" used to run the whole pipeline on the click (measured 29-31s
 * before 2026-08-28, 6-8s after the D-phase trims). Everything the pipeline
 * reads — signals, strand A/C — is already final the moment a rating's light
 * merge lands (mergeFeedbackSignalsLight), and session/end only bumps the
 * version on top. So the feedback route kicks this off after each rating:
 *
 *   precomputeNextBatch  → run the pipeline against the current DNA, park the
 *                          batch under rec_pending3:{user} with a hash of the
 *                          inputs it was built from (no LLM explanations yet).
 *   adoptPendingBatch    → session/end: if the parked batch's hash still
 *                          matches the DNA being bumped, store it as the
 *                          versioned cache and start the explanation patch.
 *                          Otherwise fall through to a full generation.
 *
 * Bursts: one precompute per user at a time (NX lock). A rating that lands
 * while one is running sets a dirty flag; the runner loops once more so the
 * LAST state is what's parked. Cost: one rerank call per burst-ish, and the
 * explanation calls only for batches that are actually adopted.
 *
 * Ratings go through precomputeWhenQuiet: the build waits until the user has
 * stopped rating for QUIET_MS. Building on every rating ran 27 full pipelines
 * in 12 minutes of one person rating and stalled the DB (2026-11-13, #240).
 */

import { createHash } from 'crypto'
import { getRedis } from '@/lib/redis'
import { createServiceClient } from '@/lib/supabase/service'
import { isSavedMarker, recordKey, titleKey } from '@/lib/title-key'
import type { DNASchema, RecommendationResult } from '@/types/dna'
import type { ContentType } from '@/lib/content-type'
import { generateRecommendations } from './generate'
import { formulaV2Enabled } from '@/lib/flags'
import { cacheRecommendations } from './step8-cache'

// `rec_pending2:` (2026-11-06): batches parked before the kids' cap and the new card lines aren't adopted.
const pendingKey = (userId: string, contentType: ContentType) => `rec_pending3:${userId}:${contentType}`
const lockKey    = (userId: string) => `rec_precompute_lock:${userId}`
const dirtyKey   = (userId: string) => `rec_precompute_dirty:${userId}`
// Per list: a movie rating and a series rating in one burst each get their batch.
const quietKey   = (userId: string, contentType: ContentType) => `rec_precompute_quiet:${userId}:${contentType}`

// A generation takes ~6-8s; the lock outlives a stuck one by a wide margin.
const LOCK_TTL_SECONDS  = 90
const DIRTY_TTL_SECONDS = 120
// One build, plus one for a rating that landed mid-build, plus one when the
// refresh hook took the parked batch for the live feed (it left nothing for
// "Find more" to adopt; seen 2026-11-13, #240).
const MAX_RUNS_PER_KICK = 3
/** No rating for this long = the user paused; build then. 8 s left "Find more" tapped soon after a rating with a one-rating-old batch (2026-11-13). */
export const QUIET_MS = 4_000
// The stamp must outlive the wait plus scheduling slop.
const QUIET_TTL_SECONDS = 30
// How long a parked batch waits to be adopted before it's discarded.
const PENDING_TTL_SECONDS = 30 * 60

interface PendingBatch {
  hash: string
  results: RecommendationResult[]
}

/**
 * Everything step 1 excludes or scores from, in one hash: signal keys with
 * their reactions, watchlist markers, and the strand values a rating nudges.
 * removed_titles is deliberately NOT included — a removed title in an
 * adopted batch is filtered at read time (GET) and only costs a slot.
 */
export function generationInputsHash(dna: DNASchema, outsideInputs = ''): string {
  const h = createHash('sha256')
  const signals = dna.signals.map(s => `${titleKey(s.type, s.tmdb_id)}=${s.reaction}`).sort()
  const saved = dna.learning_loop.recommendation_history.filter(isSavedMarker).map(recordKey).sort()
  h.update(signals.join('|'))
  h.update('#')
  h.update(saved.join('|'))
  h.update('#')
  h.update(JSON.stringify(dna.strand_a_creative_affinity))
  h.update(JSON.stringify(dna.strand_b_narrative_dimensions))
  h.update(JSON.stringify(dna.strand_c_visceral_specs))
  h.update(JSON.stringify(dna.contextual_logic))
  if (outsideInputs) h.update(`#${outsideInputs}`)
  return h.digest('hex')
}

/**
 * What a generation reads beyond the DNA, so a parked batch built before it
 * moved is never adopted as current (P2-U5). Under formula v2 the taste model
 * trains on this-or-that picks (play_events `duel`) and, with DEC-13, leans on
 * the genre screen's answers (play_state) — neither is in the DNA, and a
 * new user's last picks land after their batch was precomputed. Under v1
 * neither moves the batch, so this is '' and the hash is exactly as before.
 *
 * A failed read returns a value that matches nothing: the parked batch is
 * regenerated rather than trusted.
 */
export async function outsideInputsMark(userId: string): Promise<string> {
  if (!formulaV2Enabled()) return ''
  try {
    const db = createServiceClient()
    const [picks, play] = await Promise.all([
      db.from('play_events').select('id', { count: 'exact' })
        .eq('user_id', userId).eq('kind', 'duel').not('payload->>chosen', 'is', null)
        .order('id', { ascending: false }).limit(1),
      db.from('play_state').select('state').eq('user_id', userId).maybeSingle<{ state: Record<string, unknown> | null }>(),
    ])
    if (picks.error) throw new Error(picks.error.message)
    if (play.error && !/does not exist|schema cache/i.test(play.error.message)) throw new Error(play.error.message)
    const st = (play.data?.state ?? {}) as { gen?: unknown; sel?: unknown; loved?: unknown; onboarding?: { genres16?: unknown } }
    const answers = JSON.stringify([st.gen ?? null, st.sel ?? null, st.loved ?? null, st.onboarding?.genres16 ?? null])
    return `picks:${picks.count ?? 0}:${(picks.data?.[0] as { id?: unknown } | undefined)?.id ?? 0}|answers:${answers}`
  } catch (err) {
    console.warn('[precompute] outside inputs unavailable (no adoption):', err instanceof Error ? err.message : err)
    return `unavailable:${Date.now()}:${Math.random()}`
  }
}

/** True while a precompute for this user holds the lock (P2-U5 waits for it rather than building twice). */
export async function precomputeRunning(userId: string): Promise<boolean> {
  try {
    return (await getRedis().get(lockKey(userId))) !== null
  } catch {
    return false
  }
}

async function loadDNA(userId: string): Promise<DNASchema | null> {
  const { data } = await createServiceClient()
    .from('users')
    .select('dna')
    .eq('id', userId)
    .single<{ dna: DNASchema | null }>()
  return data?.dna ?? null
}

/**
 * Build and park the next batch for this user. Safe to call on every rating:
 * it coalesces concurrent calls and never throws.
 */
export async function precomputeNextBatch(
  userId: string,
  /** The list the user is on — a batch is built for one content type. */
  contentType: ContentType = 'all',
  /**
   * Runs after each park, while this call still holds the lock — the one
   * moment the parked batch is known to match the fingerprint it was built
   * from. refresh-batch.ts promotes it here when a refresh is due. A call
   * that found the lock taken never parks, so its hook never runs: the
   * holder's does, after the extra run this call's dirty flag forces.
   * A hook that returns non-null took the parked batch: one more build parks
   * a fresh one for "Find more".
   */
  onParked?: () => Promise<unknown>,
): Promise<void> {
  const redis = getRedis()
  // Only the holder releases the lock. An earlier version deleted it in
  // `finally` unconditionally, so a click that found the lock taken released
  // the RUNNING build's lock on its way out and the next click started a
  // second pipeline for the same user (caught in review, 2026-08-28).
  let acquired = false
  try {
    const lock = await redis.set(lockKey(userId), '1', { nx: true, ex: LOCK_TTL_SECONDS })
    if (lock === null) {
      // Someone's already building — make sure they go once more with the
      // state that includes this rating.
      await redis.set(dirtyKey(userId), '1', { ex: DIRTY_TTL_SECONDS })
      return
    }
    acquired = true

    for (let run = 0; run < MAX_RUNS_PER_KICK; run++) {
      await redis.del(dirtyKey(userId))
      const dna = await loadDNA(userId)
      if (!dna) return
      // Read before generating: anything that lands during the build makes the
      // batch older than its hash says, so it is re-checked at adoption.
      const hash = generationInputsHash(dna, await outsideInputsMark(userId))
      const results = await generateRecommendations(userId, undefined, { dna, precompute: true, contentType })
      const batch: PendingBatch = { hash, results }
      await redis.set(pendingKey(userId, contentType), batch, { ex: PENDING_TTL_SECONDS })
      let consumed = false
      if (onParked) {
        consumed = (await onParked().catch(err => {
          console.warn('[precompute] parked hook failed (non-fatal):', err instanceof Error ? err.message : err)
          return null
        })) != null
      }

      const dirty = await redis.get(dirtyKey(userId))
      if (!dirty && !consumed) break
    }
  } catch (err) {
    console.warn('[precompute] failed (non-fatal):', err instanceof Error ? err.message : err)
  } finally {
    if (acquired) await redis.del(lockKey(userId)).catch(() => {})
  }
}

/**
 * session/end: try to promote the parked batch to the versioned cache.
 * Returns the batch when adopted, null when there is none or it's stale.
 */
export async function adoptPendingBatch(
  userId: string,
  dna: DNASchema,
  contentType: ContentType = 'all',
): Promise<RecommendationResult[] | null> {
  const redis = getRedis()
  let batch: PendingBatch | null = null
  try {
    // Atomic take: a separate get + del could delete a FRESH batch parked by
    // a concurrent precompute between the two calls (review, 2026-08-28).
    // A stale batch is discarded with it — it would never be adopted anyway.
    batch = await redis.getdel<PendingBatch>(pendingKey(userId, contentType))
  } catch (err) {
    console.warn('[precompute] pending read failed (regenerating):', err instanceof Error ? err.message : err)
    return null
  }
  if (!batch?.results?.length || !batch.hash) return null
  if (batch.hash !== generationInputsHash(dna, await outsideInputsMark(userId))) {
    console.log('[precompute] pending batch stale — regenerating')
    return null
  }

  const version = dna.metadata.taste_version
  const versioned = batch.results.map(r => ({ ...r, fingerprint_version: version }))
  await cacheRecommendations(userId, version, versioned, contentType)
  console.log(`[precompute] adopted pending batch (${versioned.length}) as v${version}`)
  return versioned
}

/**
 * precomputeNextBatch once the user stops rating: each call stamps the user,
 * waits QUIET_MS, and builds only if no later call re-stamped meanwhile. A run
 * of ratings costs one build after the last one instead of one per rating.
 * Never throws.
 */
export async function precomputeWhenQuiet(
  userId: string,
  contentType: ContentType = 'all',
  onParked?: () => Promise<unknown>,
  wait: (ms: number) => Promise<void> = ms => new Promise(r => setTimeout(r, ms)),
): Promise<void> {
  const redis = getRedis()
  const stamp = `${Date.now()}:${Math.random()}`
  try {
    await redis.set(quietKey(userId, contentType), stamp, { ex: QUIET_TTL_SECONDS })
    await wait(QUIET_MS)
    if ((await redis.get(quietKey(userId, contentType))) !== stamp) {
      console.log('[precompute] superseded by a later rating, skipping')
      return
    }
  } catch (err) {
    // Redis down: build now rather than never.
    console.warn('[precompute] quiet check failed (building now):', err instanceof Error ? err.message : err)
  }
  await precomputeNextBatch(userId, contentType, onParked)
}
