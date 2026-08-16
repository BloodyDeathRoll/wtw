/**
 * generate — Main Pipeline Orchestrator
 *
 * Threads all 8 steps together for a single user recommendation request.
 * Early-returns from Redis cache when the fingerprint hasn't changed.
 *
 * Step 1 → candidates (up to 200 enriched unwatched titles)
 * Step 2 → composite scores (crew 35%, narrative 30%, visceral 20%, external 10%, recency 5%)
 * Step 3 → soft modifiers applied, list re-sorted
 * Step 4 → top 50 LLM re-ranked by Groq (all 50 kept)
 * Step 5 → stretch pick injected at slot 20 (when eligible)
 * Step 6 → ReasonPayload assembled for each title
 * Step 7 → "Why this?" explanations: first 20 before returning, the other 30
 *          in the background after the response (patched into the cache)
 * Step 8 → result cached in Redis, returned
 */

import { after } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getRedis } from '@/lib/redis'
import { getCandidates }            from './step1-candidate-gen'
import { scoreCandidates }          from './step2-composite-score'
import { applySoftModifiers }       from './step3-soft-modifiers'
import { llmRerank }                from './step4-llm-rerank'
import { injectStretchPick }        from './step5-stretch-pick'
import { buildReasonPayloads }      from './step6-reason-payload'
import { generateExplanations, toResultsWithFallback } from './step7-explanation'
import {
  getCachedRecommendations,
  cacheRecommendations,
} from './step8-cache'
import type { DNASchema, SessionContext, RecommendationResult } from '@/types/dna'

// How many titles get their LLM explanation before the response returns;
// everything after this index is explained in the background.
const FIRST_EXPLAINED_COUNT = 20

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
// Main pipeline
// ─────────────────────────────────────────────

export async function generateRecommendations(
  userId: string,
  sessionContext?: SessionContext
): Promise<RecommendationResult[]> {
  // ── Load DNA ──────────────────────────────────────────────
  const dna = await loadDNA(userId)
  if (!dna) throw new Error(`No DNA found for user ${userId}`)

  // ── Step 8 (read): check cache — BEST-EFFORT ─────────────
  // A Redis outage/auth failure must not kill generation (seen live: a
  // WRONGPASS on this read aborted the whole pipeline before the engine ran).
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

  // ── Step 1: candidate generation ─────────────────────────
  const candidates = await getCandidates(dna, sessionContext)
  if (candidates.length === 0) return []

  // ── Step 2: composite scoring ─────────────────────────────
  const scored = await scoreCandidates(candidates, dna)

  // ── Step 3: soft modifiers ────────────────────────────────
  const modified = applySoftModifiers(scored, dna, sessionContext)

  // ── Step 4: LLM re-ranking (top 50 → top 20) ─────────────
  const reranked = await llmRerank(modified, dna)

  // ── Step 5: stretch pick injection ───────────────────────
  const withStretch = injectStretchPick(reranked, scored, dna)

  // ── Step 6: reason payload assembly ──────────────────────
  const withPayloads = buildReasonPayloads(withStretch)

  // ── Step 7: explanation generation — first batch only ────
  // The explanation call is the last serial LLM round-trip, so only the
  // first 20 titles (what the user sees first) block the response. The rest
  // ship immediately with their rerank rationale as the explanation and get
  // their real blurbs generated in the background below.
  const firstBatch = withPayloads.slice(0, FIRST_EXPLAINED_COUNT)
  const rest = withPayloads.slice(FIRST_EXPLAINED_COUNT)

  const results = [
    ...(await generateExplanations(firstBatch)),
    ...toResultsWithFallback(rest),
  ]

  // Set the correct fingerprint_version on every result
  const version = dna.metadata.taste_version
  const versioned = results.map(r => ({
    ...r,
    fingerprint_version: version,
  }))

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

    // Background: generate the remaining explanations after the response is
    // sent, then patch them into the cached copy. Merges into whatever is in
    // the cache at that point (never overwrites with our own snapshot), and a
    // failure just leaves the rationale fallbacks in place.
    if (rest.length > 0) {
      after(async () => {
        try {
          // One background patch per (user, taste_version): a double-submit at
          // the same version would race two read-modify-writes on the cache
          // key and pay the LLM twice for identical work. NX lock, no release
          // — once patched there's nothing left to do at this version, and the
          // TTL clears it if the job dies midway (fallback text remains).
          const lock = await getRedis().set(
            `rec_explain_lock:${userId}:${version}`,
            '1',
            { nx: true, ex: 300 }
          )
          if (lock === null) return

          const polished = await generateExplanations(rest)
          const byKey = new Map(
            polished.map(r => [`${r.type}:${r.tmdb_id}`, r.explanation])
          )
          const current = await getCachedRecommendations(userId, version)
          if (!current) return   // cache expired or superseded — nothing to patch
          const merged = current.map(r => {
            const explanation = byKey.get(`${r.type}:${r.tmdb_id}`)
            return explanation ? { ...r, explanation } : r
          })
          await cacheRecommendations(userId, version, merged)
        } catch (err) {
          console.warn(
            '[generate] background explanations failed (fallbacks kept):',
            err instanceof Error ? err.message : err
          )
        }
      })
    }
  }

  return versioned
}
