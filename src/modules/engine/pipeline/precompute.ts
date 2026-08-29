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
 *                          batch under rec_pending:{user} with a hash of the
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
 */

import { createHash } from 'crypto'
import { getRedis } from '@/lib/redis'
import { createServiceClient } from '@/lib/supabase/service'
import { isSavedMarker, recordKey, titleKey } from '@/lib/title-key'
import type { DNASchema, RecommendationResult } from '@/types/dna'
import type { ContentType } from '@/lib/content-type'
import { generateRecommendations, scheduleExplanationPatch } from './generate'
import { cacheRecommendations } from './step8-cache'

const pendingKey = (userId: string, contentType: ContentType) => `rec_pending:${userId}:${contentType}`
const lockKey    = (userId: string) => `rec_precompute_lock:${userId}`
const dirtyKey   = (userId: string) => `rec_precompute_dirty:${userId}`

// A generation takes ~6-8s; the lock outlives a stuck one by a wide margin.
const LOCK_TTL_SECONDS  = 90
const DIRTY_TTL_SECONDS = 120
const MAX_RUNS_PER_KICK = 2
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
export function generationInputsHash(dna: DNASchema): string {
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
  return h.digest('hex')
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
      const hash = generationInputsHash(dna)
      const results = await generateRecommendations(userId, undefined, { dna, precompute: true, contentType })
      const batch: PendingBatch = { hash, results }
      await redis.set(pendingKey(userId, contentType), batch, { ex: PENDING_TTL_SECONDS })

      const dirty = await redis.get(dirtyKey(userId))
      if (!dirty) break
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
  if (batch.hash !== generationInputsHash(dna)) {
    console.log('[precompute] pending batch stale — regenerating')
    return null
  }

  const version = dna.metadata.taste_version
  const versioned = batch.results.map(r => ({ ...r, fingerprint_version: version }))
  await cacheRecommendations(userId, version, versioned, contentType)
  scheduleExplanationPatch(userId, version, versioned, contentType)
  console.log(`[precompute] adopted pending batch (${versioned.length}) as v${version}`)
  return versioned
}
