/**
 * src/modules/dna/index.ts
 *
 * Public API for the DNA Schema Writer (Assignment 3).
 *
 * Assignment 1 (Session Brain) uses:
 *   writeDNA         — call after every session with a SessionSummary
 *   patchRegretSignal — call 48hr post-watch when user submits regret signal
 *   buildEmptyDNA    — call during onboarding to initialise a new user's fingerprint
 *
 * Assignment 2 (Recommendation Engine) uses:
 *   readDNA          — call to get the current fingerprint before generating recs
 *
 * Shared / admin uses:
 *   recordRecommendationFeedback — call when user watches/rates a recommended title
 *   getSnapshots                 — returns last 5 fingerprint versions
 *   rollbackToSnapshot           — restores a previous fingerprint version
 */

export { writeDNA, patchRegretSignal }              from './writer'
export { readDNA }                                  from './reader'
export { buildEmptyDNA }                            from './init'
export { recordRecommendationFeedback }             from './learning-loop'
export { getSnapshots, rollbackToSnapshot }         from './snapshot'
export { applyAspectSurvey }                        from './strand-c-updater'

// Type re-exports for callers who need them without importing from @/types/dna directly
export type { ResolvedCrew }                        from './strand-a-updater'
