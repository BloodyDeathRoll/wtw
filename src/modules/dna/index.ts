/**
 * WTW — Assignment 3: DNA Schema Writer
 * src/modules/dna/index.ts
 *
 * This module owns:
 * - Schema update pipeline (signal integration, confidence weighting)
 * - Regret signal processing
 * - Stretch pick feedback handling
 * - Open question resolution
 * - Temporal decay application
 * - Mistral embedding regeneration
 * - Dimension notes rewriting (LLM)
 * - DNA summary card generation (LLM)
 * - Profile UI: /profile/dna, /profile/history, /profile/rules, /profile/open-questions
 * - Free-text instruction parser (Groq → structured exclusion rules)
 *
 * API routes owned by this module:
 * - POST /api/dna/update-from-session
 * - POST /api/dna/update-regret
 * - POST /api/dna/update-stretch-feedback
 * - POST /api/dna/parse-instruction
 * - GET  /api/dna/summary
 * - PATCH /api/dna/dimension
 * - DELETE /api/dna/signal
 *
 * ── Assignments 1 & 2 call these ───────────────────────────────
 *
 * Assignment 1 (Session Brain) uses:
 *   updateSchemaFromSession() / writeDNA()       — call after every session
 *   updateSchemaFromRegret() / patchRegretSignal() — call 48hr post-watch
 *   updateSchemaFromStretch()                    — call when stretch pick is rated
 *   buildEmptyDNA()                              — initialise a new user's fingerprint
 *
 * Assignment 2 (Recommendation Engine) uses:
 *   readDNA()                                    — read the current fingerprint
 */

// ── Type re-exports ───────────────────────────────────────────────────────────
// Callers can import shared types from here without reaching into @/types/dna directly.
export type {
  DNASchema,
  DNASignal,
  StrandA,
  StrandB,
  StrandC,
  SessionSummary,
  RecommendationResult,
} from '@/types/dna'
export type { ResolvedCrew } from './strand-a-updater'

// ── Core write/read API ───────────────────────────────────────────────────────
export { writeDNA, patchRegretSignal }   from './writer'
export { readDNA }                       from './reader'
export { buildEmptyDNA }                 from './init'

// ── Feedback & history ────────────────────────────────────────────────────────
export { recordRecommendationFeedback }  from './learning-loop'

// ── Snapshots & rollback ──────────────────────────────────────────────────────
export { getSnapshots, rollbackToSnapshot } from './snapshot'

// ── Opt-in deep survey ────────────────────────────────────────────────────────
export { applyAspectSurvey }             from './strand-c-updater'

// ── Teammate-compatible aliases ───────────────────────────────────────────────
// Assignment 1 may call updateSchemaFromSession / updateSchemaFromRegret /
// updateSchemaFromStretch (the names from the main-branch scaffold).
// These are thin wrappers so both naming conventions work without breaking either branch.

import type { SessionSummary, RecommendationResult } from '@/types/dna'
import { writeDNA }         from './writer'
import { patchRegretSignal } from './writer'
import { recordRecommendationFeedback } from './learning-loop'
import { readDNA }          from './reader'

export async function updateSchemaFromSession(
  userId: string,
  summary: SessionSummary,
  recommendation?: RecommendationResult,
): Promise<ReturnType<typeof readDNA>> {
  await writeDNA(userId, summary, recommendation)
  return readDNA(userId)
}

export async function updateSchemaFromRegret(
  userId: string,
  tmdbId: string,
  signal: 'glad_watched' | 'neutral' | 'regret',
): Promise<void> {
  return patchRegretSignal(userId, tmdbId, signal)
}

export async function updateSchemaFromStretch(
  userId: string,
  tmdbId: string,
  reaction: 'loved' | 'liked' | 'mixed' | 'disliked',
): Promise<void> {
  return recordRecommendationFeedback(userId, tmdbId, true, reaction)
}
