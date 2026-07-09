/**
 * Narrative Match Scorer — Step 2, weight 0.30
 *
 * Converts the user's strand_b into an embedding (using the same text
 * template as enrichTitleWithNarrative) and runs a pgvector batch cosine
 * similarity against all candidate titles in one SQL query.
 *
 * The user's embedding is Redis-cached by (user_id, taste_version) so it
 * is only regenerated when the DNA schema changes.
 *
 * Returns a Map<tmdb_id, score> for all enriched candidates.
 * Unenriched candidates (no narrative_embedding) are absent from the map;
 * the pipeline falls back to 0.5 (neutral) for those.
 *
 * Embedding text format is shared with enrichTitleWithNarrative.
 * Assignment 3 must NOT change this format without syncing here.
 */

import { embed } from 'ai'
import { createMistral } from '@ai-sdk/mistral'
import { MODELS } from '@/lib/ai-models'
import { getRedis } from '@/lib/redis'
import { createServiceClient } from '@/lib/supabase/service'
import type { StrandB, StrandC } from '@/types/dna'

// Embedding TTL: 24 hours. Taste version is part of the key so stale
// embeddings naturally fall off as new versions are created.
const EMBED_TTL_SECONDS = 86_400

function mistral() {
  const key = process.env.MISTRAL_API_KEY
  if (!key) throw new Error('MISTRAL_API_KEY is not set')
  return createMistral({ apiKey: key })
}

// ─────────────────────────────────────────────
// Embedding text template
// ─────────────────────────────────────────────

/**
 * Converts a user's strand_b + strand_c into the same text format used
 * when embedding title narrative_metadata. Keeping these identical is what
 * makes cosine similarity meaningful.
 *
 * For pacing: use the highest-weight pacing dimension.
 * For tone: use the top-2 tone dimensions by weight.
 */
export function strandBToEmbeddingText(strandB: StrandB, strandC: StrandC): string {
  // Pacing: pick the dominant weight
  const pacing = Object.entries(strandC.pacing_weights)
    .sort(([, a], [, b]) => b - a)[0]?.[0]
    ?.replace('_', ' ') ?? 'moderate'

  // Tone: top-2 by weight
  const tones = Object.entries(strandC.tone_weights)
    .filter(([, w]) => w > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 2)
    .map(([t]) => t)
    .join(', ') || 'neutral'

  const str = (v: string | number) => String(v).replace(/_/g, ' ')
  const num = (v: string | number) => Number(v).toFixed(2)
  const b = strandB

  return [
    `Pacing: ${pacing}.`,
    `Tone: ${tones}.`,
    `Moral ambiguity: ${str(b.moral_ambiguity.value)}.`,
    `Narrative complexity: ${str(b.narrative_complexity.value)}.`,
    `Emotional demand: ${str(b.emotional_demand.value)}.`,
    `Originality: ${num(b.originality_weight.value)}.`,
    `Humor style: ${str(b.humor_style.value)}.`,
    `Protagonist type: ${str(b.protagonist_type.value)}.`,
    `Ensemble vs solo: ${str(b.ensemble_vs_solo.value)}.`,
  ].join(' ')
}

// ─────────────────────────────────────────────
// Embedding with Redis cache
// ─────────────────────────────────────────────

async function getUserEmbedding(
  userId: string,
  tasteVersion: number,
  strandB: StrandB,
  strandC: StrandC
): Promise<number[]> {
  const cacheKey = `narrative_embed:${userId}:${tasteVersion}`
  const redis = getRedis()

  // Try cache first
  const cached = await redis.get<number[]>(cacheKey)
  if (cached) return cached

  // Generate via Mistral
  const text = strandBToEmbeddingText(strandB, strandC)
  const { embedding } = await embed({
    model: mistral().textEmbeddingModel(MODELS.embedding),
    value: text,
  })

  // Cache for 24h — key includes taste_version so old versions naturally expire
  await redis.set(cacheKey, embedding, { ex: EMBED_TTL_SECONDS })

  return embedding
}

// ─────────────────────────────────────────────
// Main scorer
// ─────────────────────────────────────────────

/**
 * Batch narrative similarity for all candidate titles.
 * One Mistral embed call (cached) + one pgvector SQL query.
 *
 * @returns Map<tmdb_id, score>  score is 0.0 – 1.0
 *          Unenriched titles are absent; caller uses 0.5 as fallback.
 */
export async function computeNarrativeMatchScores(
  strandB: StrandB,
  strandC: StrandC,
  userId: string,
  tasteVersion: number,
  candidateIds: string[]
): Promise<Map<string, number>> {
  if (candidateIds.length === 0) return new Map()

  const embedding = await getUserEmbedding(userId, tasteVersion, strandB, strandC)

  const supabase = createServiceClient()
  const { data, error } = await supabase.rpc('match_titles_by_narrative', {
    query_embedding: embedding,
    candidate_ids: candidateIds,
  })

  if (error) {
    throw new Error(`match_titles_by_narrative RPC failed: ${error.message}`)
  }

  const scores = new Map<string, number>()
  for (const row of (data ?? []) as { tmdb_id: string; score: number }[]) {
    scores.set(row.tmdb_id, row.score)
  }
  return scores
}
