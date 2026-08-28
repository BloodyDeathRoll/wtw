/**
 * generate — Main Pipeline Orchestrator
 *
 * Threads all 8 steps together for a single user recommendation request.
 * Early-returns from Redis cache when the fingerprint hasn't changed.
 *
 * Step 1 → candidates: fresh pool (never served: most-voted ∪ nearest to the
 *          fingerprint) + seen pool (served before, never rated)
 * Step 2 → composite scores (crew 35%, narrative 30%, visceral 20%, external 10%, recency 5%)
 * Step 3 → soft modifiers applied, list re-sorted
 * Step 3b → batch of 50 composed: 80% fresh / 20% seen, by score
 * Step 4 → the 50 LLM re-ranked, ids only (all 50 kept)
 * Step 5 → stretch pick injected at slot 20 (when eligible)
 * Step 6 → ReasonPayload assembled for each title
 * Step 8 → result cached in Redis with template "Why this?" text, returned
 * Step 7 → LLM explanations for all 50 generated AFTER the response and
 *          patched into the cache (order untouched, so pagination is stable)
 *
 * Only one LLM round-trip (step 4) blocks the response since 2026-08-28; the
 * explanation calls used to be the second serial one (~4-12s for 20 titles).
 * Measured after: 6-8s per generation (was 29-31s), 3s of it the rerank.
 *
 * precompute.ts runs this same pipeline in the background after each rating
 * (opts.precompute) so a "Find more" usually only has to adopt the result.
 */

import { after } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getRedis } from '@/lib/redis'
import { startTimer } from '@/lib/timing'
import { ensureWatchProviders }     from '../enrichment/ensure-watch-providers'
import { getCandidates }            from './step1-candidate-gen'
import { scoreCandidates }          from './step2-composite-score'
import { applySoftModifiers }       from './step3-soft-modifiers'
import { composeBatch }             from './step3b-compose-batch'
import { llmRerank }                from './step4-llm-rerank'
import { injectStretchPick }        from './step5-stretch-pick'
import { buildReasonPayloads }      from './step6-reason-payload'
import { explainMany, resultToExplainItem, toResultsWithFallback } from './step7-explanation'
import {
  getCachedRecommendations,
  cacheRecommendations,
} from './step8-cache'
import type { DNASchema, SessionContext, RecommendationResult } from '@/types/dna'

export interface GenerateOptions {
  /**
   * A DNA the caller already holds (session/end just wrote it). Skips the
   * users.dna re-read — the third in one "Find more" request otherwise.
   */
  dna?: DNASchema
  /**
   * Skip the cache read. session/end just bumped taste_version, so the read
   * is a guaranteed miss.
   */
  skipCacheRead?: boolean
  /**
   * Precompute mode (precompute.ts): return the batch WITHOUT writing the
   * versioned rec cache and WITHOUT starting the explanation patch — the
   * batch may be superseded before anyone reads it, and the LLM spend should
   * wait until session/end adopts it.
   */
  precompute?: boolean
}

// ─────────────────────────────────────────────
// DNA loader
// ─────────────────────────────────────────────

async function loadDNA(userId: string): Promise<DNASchema | null> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('users')
    .select('dna')
    .eq('id', userId)
    .single<{ dna: DNASchema | null }>()

  if (error || !data?.dna) return null
  return data.dna
}

// ─────────────────────────────────────────────
// Background explanations → cache
// ─────────────────────────────────────────────

/**
 * Generate LLM explanations for `results` and merge them into the cached
 * batch at (userId, version). Never reorders and never overwrites with its
 * own snapshot; a failure leaves the template text in place. Runs after the
 * response when there is one — `after` throws outside a request scope (a
 * script, a cron, the E2E harness), and there it just runs fire-and-forget.
 */
export function scheduleExplanationPatch(
  userId: string,
  version: number,
  results: RecommendationResult[],
): void {
  if (results.length === 0) return
  const patch = async () => {
    try {
      // One background patch per (user, taste_version): a double-submit at
      // the same version would race two read-modify-writes on the cache key
      // and pay the LLM twice for identical work. NX lock, no release — once
      // patched there's nothing left to do at this version, and the TTL
      // clears it if the job dies midway (template text remains).
      const lock = await getRedis().set(
        `rec_explain_lock:${userId}:${version}`,
        '1',
        { nx: true, ex: 300 }
      )
      if (lock === null) return

      const bt = startTimer('generate/explain')
      const byKey = await explainMany(results.map(resultToExplainItem))
      const current = await getCachedRecommendations(userId, version)
      if (!current) return   // cache expired or superseded — nothing to patch
      const merged = current.map(r => {
        const explanation = byKey.get(`${r.type}:${r.tmdb_id}`)
        return explanation ? { ...r, explanation } : r
      })
      await cacheRecommendations(userId, version, merged)
      bt.done(`patched ${byKey.size}/${results.length} explanations`)
    } catch (err) {
      console.warn(
        '[generate] background explanations failed (template text kept):',
        err instanceof Error ? err.message : err
      )
    }
  }
  try {
    after(patch)
  } catch {
    void patch()
  }
}

/**
 * Streaming availability for a whole batch (decided 2026-08-28: checked on
 * demand per batch, not just by the nightly 150/night job). Best-effort —
 * a failure only means some cards stay without a "Watch on …" line.
 */
async function checkBatchProviders(results: RecommendationResult[]): Promise<void> {
  try {
    await ensureWatchProviders(results.map(r => ({ tmdb_id: r.tmdb_id, type: r.type })))
  } catch (err) {
    console.warn('[generate] provider check failed (non-fatal):', err instanceof Error ? err.message : err)
  }
}

// ─────────────────────────────────────────────
// Main pipeline
// ─────────────────────────────────────────────

export async function generateRecommendations(
  userId: string,
  sessionContext?: SessionContext,
  opts: GenerateOptions = {},
): Promise<RecommendationResult[]> {
  const t = startTimer(opts.precompute ? 'generate/precompute' : 'generate')

  // ── Load DNA ──────────────────────────────────────────────
  const dna = opts.dna ?? await loadDNA(userId)
  if (!dna) throw new Error(`No DNA found for user ${userId}`)

  // ── Step 8 (read): check cache — BEST-EFFORT ─────────────
  // A Redis outage/auth failure must not kill generation (seen live: a
  // WRONGPASS on this read aborted the whole pipeline before the engine ran).
  if (!opts.skipCacheRead && !opts.precompute) {
    const cached = await getCachedRecommendations(userId, dna.metadata.taste_version)
      .catch(err => {
        console.warn('[generate] cache read failed (non-fatal):', err instanceof Error ? err.message : err)
        return null
      })
    if (cached) {
      // Session context modifiers (mood, immediate request) bypass the cache
      // when session_override_active — re-run soft modifiers only, don't re-score
      if (!sessionContext?.session_override_active) {
        return cached
      }
    }
  }
  t.mark('load + cache check')

  // ── Step 1: candidate generation ─────────────────────────
  const candidates = await getCandidates(dna, sessionContext)
  t.mark(`step1 candidates (${candidates.length})`)
  if (candidates.length === 0) return []

  // ── Step 2: composite scoring ─────────────────────────────
  const scored = await scoreCandidates(candidates, dna)
  t.mark('step2 scoring')

  // ── Step 3: soft modifiers ────────────────────────────────
  const modified = applySoftModifiers(scored, dna, sessionContext)

  // ── Step 3b: 80% fresh / 20% previously-served, by score ─
  const batch = composeBatch(modified)

  // ── Step 4: LLM re-ranking of the batch ──────────────────
  const reranked = await llmRerank(batch, dna)
  t.mark('step4 rerank')

  // ── Step 5: stretch pick injection ───────────────────────
  const withStretch = injectStretchPick(reranked, scored, dna)

  // ── Step 6: reason payload assembly ──────────────────────
  const withPayloads = buildReasonPayloads(withStretch)

  // ── Results with template explanations ───────────────────
  // Every card ships with a one-line "Why this?" built from its reason
  // payload (positive signal + caveat). The LLM blurbs replace them in the
  // cache below, after the response.
  const version = dna.metadata.taste_version
  const versioned = toResultsWithFallback(withPayloads).map(r => ({
    ...r,
    fingerprint_version: version,
  }))

  // ── Precompute mode: hand the batch back, no cache, no explanations yet ─
  // precompute.ts parks it under its key together with the inputs hash.
  // Already in the background, so the provider check runs inline: by the
  // time session/end adopts the batch every card that CAN say "Watch on …"
  // does.
  if (opts.precompute) {
    await checkBatchProviders(versioned)
    t.mark('watch providers')
    t.done('total (pending)')
    return versioned
  }

  // ── Step 8 (write): cache result ─────────────────────────
  // Don't cache when session override is active (mood-specific results
  // shouldn't be served to future sessions without that mood context)
  if (!sessionContext?.session_override_active) {
    // Best-effort: a failed cache write degrades to "GET serves mocks until
    // the next successful run" — it must not throw away generated results.
    await cacheRecommendations(userId, version, versioned)
      .catch(err => {
        console.warn('[generate] cache write failed (non-fatal):', err instanceof Error ? err.message : err)
      })
    t.mark('cache write')

    // ── Step 7 (background): LLM explanations, patched into the cache ──
    scheduleExplanationPatch(userId, version, versioned)

    // ── Background: streaming availability for the whole batch ────────
    // The GET route also checks the few unchecked titles on each page it
    // serves, so the first page never waits on this.
    const providers = () => checkBatchProviders(versioned)
    try {
      after(providers)
    } catch {
      void providers()
    }
  }

  t.done()
  return versioned
}
