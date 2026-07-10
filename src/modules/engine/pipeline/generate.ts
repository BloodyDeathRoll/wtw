/**
 * generate — Main Pipeline Orchestrator
 *
 * Threads all 8 steps together for a single user recommendation request.
 * Early-returns from Redis cache when the fingerprint hasn't changed.
 *
 * Step 1 → candidates (up to 200 enriched unwatched titles)
 * Step 2 → composite scores (crew 35%, narrative 30%, visceral 20%, external 10%, recency 5%)
 * Step 3 → soft modifiers applied, list re-sorted
 * Step 4 → top 50 LLM re-ranked by Groq → take top 20
 * Step 5 → stretch pick injected at slot 20 (when eligible)
 * Step 6 → ReasonPayload assembled for each title
 * Step 7 → plain-language "Why this?" explanation generated (batch Groq call)
 * Step 8 → result cached in Redis, returned
 */

import { createServiceClient } from '@/lib/supabase/service'
import { getCandidates }            from './step1-candidate-gen'
import { scoreCandidates }          from './step2-composite-score'
import { applySoftModifiers }       from './step3-soft-modifiers'
import { llmRerank }                from './step4-llm-rerank'
import { injectStretchPick }        from './step5-stretch-pick'
import { buildReasonPayloads }      from './step6-reason-payload'
import { generateExplanations }     from './step7-explanation'
import {
  getCachedRecommendations,
  cacheRecommendations,
} from './step8-cache'
import type { DNASchema, SessionContext, RecommendationResult } from '@/types/dna'

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

  // ── Step 7: explanation generation ───────────────────────
  const results = await generateExplanations(withPayloads)

  // Set the correct fingerprint_version on every result
  const versioned = results.map(r => ({
    ...r,
    fingerprint_version: dna.metadata.taste_version,
  }))

  // ── Step 8 (write): cache result ─────────────────────────
  // Don't cache when session override is active (mood-specific results
  // shouldn't be served to future sessions without that mood context)
  if (!sessionContext?.session_override_active) {
    // Best-effort: a failed cache write degrades to "GET serves mocks until
    // the next successful run" — it must not throw away generated results.
    await cacheRecommendations(userId, dna.metadata.taste_version, versioned)
      .catch(err => {
        console.warn('[generate] cache write failed (non-fatal):', err instanceof Error ? err.message : err)
      })
  }

  return versioned
}
