/**
 * WTW — Assignment 2: Recommendation Engine
 * src/modules/engine/index.ts
 *
 * This module owns:
 * - Candidate generation from TMDB
 * - Composite scoring pipeline (crew affinity + pgvector + visceral + external ratings)
 * - Creative lineage graph traversal
 * - Groq LLM re-ranking
 * - Stretch pick injection
 * - Reason payload assembly
 * - Plain-language explanation generation
 * - Co-watch fingerprint intersection mode
 * - Upstash Redis caching
 * - TMDB + OMDB content enrichment utilities
 * - Nightly enrichment cron
 *
 * Exports:
 * - RecommendationResult
 * - CowatchResult
 * - ReasonPayload
 *
 * API routes owned by this module:
 * - POST /api/recommendations/generate
 * - POST /api/recommendations/cowatch
 * - GET  /api/recommendations/explain
 * - POST /api/recommendations/feedback
 */

export type { RecommendationResult, CowatchResult, ReasonPayload } from '@/types/dna'

// Scoring pipeline and utilities will be exported here as they are built.
