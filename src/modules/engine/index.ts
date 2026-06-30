/**
 * WTW — Recommendation Engine: Public API
 *
 * The only file other modules (Assignment 1 session brain, Assignment 3 DNA writer,
 * and API routes) should import from. Everything else in src/modules/engine/ is private.
 */

// ── Core pipeline ─────────────────────────────────────────
export { generateRecommendations }          from './pipeline/generate'
export { generateCowatchRecommendations }   from './cowatch/intersection'

// ── Enrichment utilities (also used by cron and seed scripts) ──
export { fetchAndCacheTitle, discoverAndSeed } from './enrichment/fetch-and-cache-title'
export { enrichTitleWithNarrative }            from './enrichment/enrich-title-narrative'
export { buildLineageGraph }                   from './enrichment/build-lineage-graph'
export { runNightlyEnrichment }                from './enrichment/nightly-enrichment'

// ── Cache utilities (used by feedback route to invalidate) ────
export {
  recCacheKey,
  cowatchCacheKey,
  getCachedRecommendations,
  cacheRecommendations,
} from './pipeline/step8-cache'

// ── Public types (re-exported for consumers) ──────────────
// These are defined in src/types/dna.ts — the shared contract.
// Re-exported here so consumers only need one import.
export type {
  RecommendationResult,
  CowatchResult,
  ReasonPayload,
  SessionContext,
} from '@/types/dna'
