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
  /** Groq — free-form TEXT generation only: `generateText` / `streamText`
   *  (chat, welcome greeting, DNA summary/notes/instruction-parse). A reasoning
   *  model is FINE here — the answer is the streamed/returned text. Do NOT use
   *  this with `generateObject` (see `structured` below). Was
   *  `llama-3.3-70b-versatile` (Groq free-tier shutdown 2026-08-16). */
  text: 'openai/gpt-oss-120b',

  /** STRUCTURED output via `generateObject` on the low-volume, latency-sensitive
   *  paths: engine rerank / explanation / co-watch, and session transcript
   *  analysis. MUST be NON-reasoning — reasoning models (Groq gpt-oss-*, qwen3.6)
   *  spend their budget on a `reasoning` trace and often return empty `content`,
   *  which `generateObject` can't parse. Measured 2026-07-09: gpt-oss-120b fails
   *  ~1/6 on complex schemas (e.g. analyze-session) and these sites sit in the
   *  rec pipeline with no try/catch → one failure zeroes out generateRecommendations
   *  → GET keeps serving mocks. Mistral is reliable here. Kept separate from
   *  `text` (which stays on fast Groq for streaming chat). */
  structured: 'mistral-small-latest',

  /** BULK structured enrichment (narrative extraction + lineage graphs) via
   *  generateObject. Same NON-reasoning requirement as `structured`, but kept a
   *  distinct key because it is HIGH-VOLUME + rate-sensitive and may diverge
   *  (e.g. move to a paid fast model) independently of the live-path sites.
   *  Mistral free tier measured live at 50K TPM / 50 req-min, no daily wall (vs
   *  Groq 12K TPM + daily token budget, Gemini free ~20 req/DAY — both hit during
   *  2026-07-09 seeding). Driven serially by the enrichment loop. */
  enrichment: 'mistral-small-latest',

  /** Mistral — narrative + fingerprint embeddings (1024-dim, matches the
   *  vector(1024) columns in the Supabase migrations). */
  embedding: 'mistral-embed',

  /** Gemini Live — native audio-to-audio voice mode. Preview model;
   *  successor is `gemini-3.1-flash-live-preview` when this is retired. */
  voice: 'gemini-2.5-flash-native-audio-preview-12-2025',
} as const

export type ModelKey = keyof typeof MODELS
