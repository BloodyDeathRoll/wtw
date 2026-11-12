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
 *
 * ⚠️ The reasoning IS billed against `maxOutputTokens`, and an earlier note here
 * claimed otherwise. That claim came from a one-line prompt (121 completion
 * tokens, `finishReason: 'stop'` at a cap of 150) and did not survive a real
 * one: with the chat's full system prompt and a 60-message history, a cap of
 * 300 returned `finishReason: 'length'` with the reply cut off mid-sentence,
 * and on a longer trace no reply at all. Budget for the trace as well as the
 * answer at every call site, and measure on a REPRESENTATIVE prompt.
 *
 * `@ai-sdk/groq` forwards only `reasoningFormat`, not `reasoning_effort`, so
 * the trace cannot be shortened from here — only paid for.
 */
export const GROQ_TEXT_OPTIONS = { groq: { reasoningFormat: 'hidden' } } as const

export const MODELS = {
  /** Gemini TTS — offline only: records the pre-recorded intros
   *  (scripts/record-intro.mts). Free tier is a handful of requests a day. */
  tts: 'gemini-2.5-flash-preview-tts',

  /** Groq — free-form TEXT generation only: `generateText` / `streamText`
   *  (chat, welcome greeting, DNA summary, dimension notes). Do NOT use
   *  this for structured output (see `structured` below). Was
   *  `llama-3.3-70b-versatile` (Groq free-tier shutdown 2026-08-16).
   *
   *  ⚠️ It is a REASONING model, and every call site must pass
   *  `GROQ_TEXT_OPTIONS`. Without them it spends its budget on the reasoning
   *  trace and returns an EMPTY `content` — measured live 2026-09-20, which is
   *  what surfaced in the app as "Couldn't reach the model." This file used to
   *  claim a reasoning model was fine for text because "the answer is the
   *  returned text"; it is not, unless the reasoning is separated out. */
  text: 'openai/gpt-oss-120b',

  /** STRUCTURED output (`generateText` + `Output.object`) on the low-volume,
   *  latency-sensitive paths: engine explanation / co-watch, and session
   *  transcript analysis (the engine rerank moved to `jev` on 2026-11-05).
   *  MUST be NON-reasoning — reasoning models (Groq gpt-oss-*, qwen3.6)
   *  spend their budget on a `reasoning` trace and often return empty `content`,
   *  which structured output can't parse. Measured 2026-07-09: gpt-oss-120b fails
   *  ~1/6 on complex schemas (e.g. analyze-session) and these sites sit in the
   *  rec pipeline with no try/catch → one failure zeroes out generateRecommendations
   *  → GET keeps serving mocks. Mistral is reliable here. Kept separate from
   *  `text` (which stays on fast Groq for streaming chat). Was
   *  `mistral-small-latest` until Mistral moved small/medium/magistral/devstral
   *  off the free tier (measured 2026-09-07: 0 req/min, 429 on every call since
   *  09-04). ministral-8b keeps 188 req/min free and passes json_schema output. */
  structured: 'ministral-8b-latest',

  /** Groq — writes the "Why it's a match" text from facts
   *  (src/modules/engine/why/write-why.ts). NOT `text`: that model's free
   *  budget (200,000 tokens a day) is the chat's, and testing this feature on
   *  it ran the budget out on 2026-11-06. Chosen 2026-11-06 over gpt-oss-20b
   *  on the same 12 titles: Qwen kept every rule first time (gpt-oss-20b: 4
   *  of 12 fell back to plain text). Qwen caps OUTPUT tokens at 1,000 a
   *  minute, so it runs without reasoning (~100 output tokens a text). */
  whyWriter: 'qwen/qwen3.8-27b',

  /** Groq — the fact-check on that text: reads the facts and the draft, lists
   *  anything the draft says that the facts don't. Measured 2026-11-06 on 8
   *  known cases (invented scenes, a made-up dog, a scholarship, an actor):
   *  7 right; the miss was being too strict. A different model from the
   *  writer on purpose — each has its own free budget. */
  whyJudge: 'openai/gpt-oss-20b',

  /** "Why it's a match" backups (2026-11-06): when a model is out of its free
   *  daily budget or down, the next one in line writes / fact-checks, so one
   *  empty budget doesn't turn every user's sheet into plain text (it did,
   *  2026-11-06, after testing used up whyWriter's 200k tokens). gpt-oss-20b
   *  is also the judge — its own budget; ministral-8b is on Mistral's free
   *  tier, no daily wall. Every draft still passes the same checks. */
  whyWriterBackup: 'openai/gpt-oss-20b',
  whyWriterLast: 'ministral-8b-latest',
  whyJudgeBackup: 'ministral-8b-latest',

  /** Mistral — one-sentence plot summaries for feed cards whose catalogue
   *  plot won't fit four lines (src/modules/engine/pipeline/card-plot.ts).
   *  Written once per TITLE, shared by every user and cached, so volume is
   *  low; on Mistral's free tier (no daily wall) so it never touches the
   *  chat's or the "why" writer's Groq budgets. Non-reasoning, plain text. */
  cardPlot: 'ministral-8b-latest',

  /** BULK structured enrichment (narrative extraction + lineage graphs) via
   *  structured output. Same NON-reasoning requirement as `structured`, but kept a
   *  distinct key because it is HIGH-VOLUME + rate-sensitive and may diverge
   *  (e.g. move to a paid fast model) independently of the live-path sites.
   *  Mistral free tier measured live at 50K TPM / 50 req-min, no daily wall (vs
   *  Groq 12K TPM + daily token budget, Gemini free ~20 req/DAY — both hit during
   *  2026-07-09 seeding). Driven serially by the enrichment loop. Same
   *  2026-09-07 free-tier move as `structured`: ministral-8b (188 req/min free)
   *  replaces mistral-small (0). */
  enrichment: 'ministral-8b-latest',

  /** Jev (typesafe.ai System One) — yes/no probabilities, not text. Engine
   *  step 4 (`src/lib/jev.ts`): one request asks, per candidate, whether the
   *  viewer would dislike it and drops the sure ones; order is untouched.
   *  ~0.4s for 50 measured 2026-11-05, against 5–20s for the Mistral rerank
   *  it replaced. On failure the batch is served as scored and the failure
   *  is logged to Redis for the devs. `-latest` floats: pin once measured. */
  jev: 'jev-latest',

  /** Mistral — narrative + fingerprint embeddings (1024-dim, matches the
   *  vector(1024) columns in the Supabase migrations). */
  embedding: 'mistral-embed',

  /** Gemini Live — native audio-to-audio voice mode. Preview model;
   *  successor is `gemini-3.1-flash-live-preview` when this is retired. */
  voice: 'gemini-2.5-flash-native-audio-preview-12-2025',
} as const

export type ModelKey = keyof typeof MODELS
