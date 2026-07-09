// ============================================================
// WTW — LLM model IDs: single source of truth
// ============================================================
// Never hardcode a model string inside a module. Import from here.
// Swapping a model (deprecation, cost, speed) is a one-line change
// in this file that propagates to every call site.
//
// Provider clients are still constructed per-module (createGroq /
// createMistral / Gemini); only the *model identifier* is centralized.

export const MODELS = {
  /** Groq — general chat, instruction following, reranking. Low-volume,
   *  latency-sensitive paths. Was `llama-3.3-70b-versatile` (Groq free-tier
   *  shutdown 2026-08-16). */
  text: 'openai/gpt-oss-120b',

  /** BULK structured enrichment (narrative extraction + lineage graphs) via
   *  generateObject. MUST be a NON-reasoning model — reasoning models (Groq's
   *  gpt-oss-*, qwen3.6) emit their answer as `reasoning` with empty `content`,
   *  which generateObject can't parse.
   *
   *  Mistral chat on the SAME key as embeddings: free tier measured live at
   *  50K TPM / 50 req-min with no daily wall (vs Groq 12K TPM + daily token
   *  budget, Gemini free ~20 req/DAY — both hit during 2026-07-09 seeding).
   *  Driven serially by the enrichment loop. */
  enrichment: 'mistral-small-latest',

  /** Mistral — narrative + fingerprint embeddings (1024-dim, matches the
   *  vector(1024) columns in the Supabase migrations). */
  embedding: 'mistral-embed',

  /** Gemini Live — native audio-to-audio voice mode. Preview model;
   *  successor is `gemini-3.1-flash-live-preview` when this is retired. */
  voice: 'gemini-2.5-flash-native-audio-preview-12-2025',
} as const

export type ModelKey = keyof typeof MODELS
