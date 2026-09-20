// ============================================================
// WTW — LLM model IDs: single source of truth
// ============================================================
// Never hardcode a model string inside a module. Import from here.
// Swapping a model (deprecation, cost, speed) is a one-line change
// in this file that propagates to every call site.
//
// Provider clients are still constructed per-module (createGroq /
// createMistral / Gemini); only the *model identifier* is centralized.

/**
 * Required on every `MODELS.text` call. `reasoningFormat: 'hidden'` keeps the
 * model's reasoning out of `content` instead of letting it consume the whole
 * response — without it `generateText`/`streamText` return an empty string.
 * Verified both 'hidden' and 'parsed' fix it; 'hidden' is right for user-facing
 * copy, where the trace is noise.
 */
export const GROQ_TEXT_OPTIONS = { groq: { reasoningFormat: 'hidden' } } as const

export const MODELS = {
  /** Groq — free-form TEXT generation only: `generateText` / `streamText`
   *  (chat, welcome greeting, DNA summary/notes/instruction-parse). Do NOT use
   *  this with `generateObject` (see `structured` below). Was
   *  `llama-3.3-70b-versatile` (Groq free-tier shutdown 2026-08-16).
   *
   *  ⚠️ It is a REASONING model, and every call site must pass
   *  `GROQ_TEXT_OPTIONS`. Without them it spends its budget on the reasoning
   *  trace and returns an EMPTY `content` — measured live 2026-09-20, which is
   *  what surfaced in the app as "Couldn't reach the model." This file used to
   *  claim a reasoning model was fine for text because "the answer is the
   *  returned text"; it is not, unless the reasoning is separated out. */
  text: 'openai/gpt-oss-120b',

  /** STRUCTURED output via `generateObject` on the low-volume, latency-sensitive
   *  paths: engine rerank / explanation / co-watch, and session transcript
   *  analysis. MUST be NON-reasoning — reasoning models (Groq gpt-oss-*, qwen3.6)
   *  spend their budget on a `reasoning` trace and often return empty `content`,
   *  which `generateObject` can't parse. Measured 2026-07-09: gpt-oss-120b fails
   *  ~1/6 on complex schemas (e.g. analyze-session) and these sites sit in the
   *  rec pipeline with no try/catch → one failure zeroes out generateRecommendations
   *  → GET keeps serving mocks. Mistral is reliable here. Kept separate from
   *  `text` (which stays on fast Groq for streaming chat). Was
   *  `mistral-small-latest` until Mistral moved small/medium/magistral/devstral
   *  off the free tier (measured 2026-09-07: 0 req/min, 429 on every call since
   *  09-04). ministral-8b keeps 188 req/min free and passes json_schema output. */
  structured: 'ministral-8b-latest',

  /** BULK structured enrichment (narrative extraction + lineage graphs) via
   *  generateObject. Same NON-reasoning requirement as `structured`, but kept a
   *  distinct key because it is HIGH-VOLUME + rate-sensitive and may diverge
   *  (e.g. move to a paid fast model) independently of the live-path sites.
   *  Mistral free tier measured live at 50K TPM / 50 req-min, no daily wall (vs
   *  Groq 12K TPM + daily token budget, Gemini free ~20 req/DAY — both hit during
   *  2026-07-09 seeding). Driven serially by the enrichment loop. Same
   *  2026-09-07 free-tier move as `structured`: ministral-8b (188 req/min free)
   *  replaces mistral-small (0). */
  enrichment: 'ministral-8b-latest',

  /** Mistral — narrative + fingerprint embeddings (1024-dim, matches the
   *  vector(1024) columns in the Supabase migrations). */
  embedding: 'mistral-embed',

  /** Gemini Live — native audio-to-audio voice mode. Preview model;
   *  successor is `gemini-3.1-flash-live-preview` when this is retired. */
  voice: 'gemini-2.5-flash-native-audio-preview-12-2025',
} as const

export type ModelKey = keyof typeof MODELS
