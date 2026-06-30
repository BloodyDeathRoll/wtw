/**
 * WTW — Assignment 3: DNA Schema Writer
 * src/modules/dna/index.ts
 *
 * Public API for the DNA Writer module.
 *
 * This module owns:
 * - Schema update pipeline (signal integration, confidence weighting)
 * - Regret signal processing
 * - Stretch pick feedback handling
 * - Open question resolution
 * - Temporal decay application
 * - Mistral embedding regeneration
 * - Dimension notes rewriting (LLM)
 * - Versioned snapshots (keep-last-5, rollback)
 * - Profile UI: /profile/dna
 * - Free-text instruction parser (Groq → structured exclusion rules)
 *
 * API routes owned by this module:
 * - POST /api/dna/update-from-session
 * - POST /api/dna/bootstrap
 * - POST /api/dna/parse-instruction
 * - GET  /api/dna/summary
 *
 * Regret + stretch pick feedback are triggered from
 * POST /api/recommendations/feedback (Assignment 2's route), which calls
 * updateSchemaFromRegret / updateSchemaFromStretch below directly.
 *
 * ── Assignments 1 & 2 call these ───────────────────────────────
 *
 * Assignment 1 (Session Brain) uses:
 *   updateSchemaFromSession()  — call after every session
 *   createBlankDNA()           — initialise a new user's fingerprint
 *
 * Assignment 2 (Recommendation Engine) uses:
 *   loadDNA()                  — read the current fingerprint
 */

export type { DNASchema, DNASignal, StrandA, StrandB, StrandC } from '@/types/dna'

// ── Core read/write API ───────────────────────────────────────────────────────
export { loadDNA, saveDNA, invalidateDNACache } from './lib/load-save'
export { createBlankDNA } from './blank-dna'

// ── Session / feedback pipelines ──────────────────────────────────────────────
export { updateSchemaFromSession } from './update-from-session'
export { updateSchemaFromRegret } from './update-from-regret'
export { updateSchemaFromStretch } from './update-from-stretch'
export { updateSchemaFromSurvey } from './update-from-survey'

// ── Temporal decay & embeddings ───────────────────────────────────────────────
export { applyTemporalDecay } from './lib/apply-temporal-decay'
export { regenerateEmbedding } from './lib/regenerate-embedding'

// ── Snapshots & rollback ──────────────────────────────────────────────────────
export { storeSnapshot, getSnapshots, rollbackToSnapshot } from './lib/snapshot'
