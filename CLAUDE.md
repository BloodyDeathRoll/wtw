# WTW — What To Watch
## Claude Code Master Context File

> Read this file at the start of every session before writing a single line of code.
> Update the "Current Status" section before ending every session.

---

## Project in one line

WTW is an AI-powered film and TV recommendation engine that builds a continuously evolving viewer fingerprint — modeling affinity for specific directors, writers, and actors, narrative preferences, and taste at a deeper level than any existing platform — to deliver personalized, explainable recommendations that get smarter every time you use it.

---

## Repository

**GitHub:** https://github.com/BloodyDeathRoll/wtw.git

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15, App Router, TypeScript |
| UI | Tailwind CSS + shadcn/ui + Radix UI |
| Motion | Framer Motion |
| PWA | next-pwa |
| Auth | Supabase Auth (email + Google OAuth) |
| Database | Supabase — Postgres + pgvector extension |
| Cache | Upstash Redis (free tier) |
| AI Orchestration | Vercel AI SDK |
| LLM — speed (text) | Groq / `openai/gpt-oss-120b` (free tier) — model IDs centralized in `src/lib/ai-models.ts`, never hardcode in a module |
| LLM — voice (audio↔audio) | Gemini Live 2.5 Flash (native audio-to-audio) |
| LLM — embeddings | Mistral embed (free tier) |
| Content metadata | TMDB API (free) |
| Ratings supplement | OMDB API (free tier) |

---

## Folder Structure & Ownership

```
wtw/
├── CLAUDE.md                        ← YOU ARE HERE. Read first, update before closing.
├── GITGUIDE.md                      ← Simple git instructions for all collaborators
├── docs/
│   └── master_dna_schema.json       ← Shared DNA contract. Read-only reference.
├── src/
│   ├── types/
│   │   └── dna.ts                   ← ⚠️ SHARED CONTRACT. Never modify alone.
│   ├── modules/
│   │   ├── session/                 ← 🔵 ASSIGNMENT 1 — Session Brain
│   │   ├── engine/                  ← 🟣 ASSIGNMENT 2 — Recommendation Engine
│   │   └── dna/                     ← 🟠 ASSIGNMENT 3 — DNA Schema Writer
│   ├── app/                         ← Next.js App Router (shared, coordinate before touching)
│   └── lib/                         ← Supabase client, Redis, shared utils (shared)
```

### Who owns what

| Path | Owner | Rule |
|---|---|---|
| `src/types/dna.ts` | Everyone | All three must approve any change |
| `src/modules/session/` | Assignment 1 | Others do not modify |
| `src/modules/engine/` | Assignment 2 | Others do not modify |
| `src/modules/dna/` | Assignment 3 | Others do not modify |
| `src/app/` | Shared | Coordinate before touching — one person at a time |
| `src/lib/` | Shared | First person who needs a utility builds it |

---

## The DNA Schema — The Shared Contract

Every module reads from or writes to this structure. Field names and types are fixed.
Full reference: `docs/master_dna_schema.json`

**Critical rules:**
- Never overwrite the full schema — always merge/patch specific fields
- Always increment `metadata.taste_version` and update `metadata.last_updated` after any write
- Confidence values increase when corroborated, decrease when contradicted
- `learning_loop.open_questions` is append-only during a session — the DNA Writer resolves them
- The schema lives in Supabase as a JSONB column on the `users` table

**Top-level structure:**
```typescript
{
  metadata:               // user_id, schema_version, taste_version, last_updated, total_sessions
  strand_a_creative_affinity:   // directors, writers, cinematographers, actors (score + confidence)
  strand_b_narrative_dimensions: // moral_ambiguity, narrative_complexity, emotional_demand, etc.
  strand_c_visceral_specs:       // pacing_weights, tone_weights, aspect_weights
  contextual_logic:              // exclusion_rules, soft_preferences, temporal_modifiers
  signals:                       // everything watched + reactions (the raw history)
  learning_loop:                 // open_questions, stretch_pick_history, recommendation_history
}
```

---

## Branch Names

> **Integration phase:** the per-assignment `feature/*` branches are merged and retired. Cut a fresh short-lived branch off `main` per task, named by the work — see `GITGUIDE.md`.

| Prefix | Use | Example |
|---|---|---|
| `feat/…` | new functionality | `feat/wire-dna-on-session-end` |
| `fix/…` | bug fix | `fix/external-rating-halving` |
| `test/…` | tests / harness | `test/vitest-setup` |
| `chore/…` | tooling, docs, config | `chore/update-claude-md` |

---

## Interfaces Between Modules

These are the exact types that connect the three modules.
Full definitions live in `src/types/dna.ts`.

### SessionSummary
Produced by Assignment 1 → consumed by Assignment 3 after every session.
```typescript
interface SessionSummary {
  session_number: number
  new_signals: DNASignal[]
  dimension_updates: Partial<StrandB>
  open_questions_resolved: string[]
  new_open_questions: string[]
  recommendation_made: string | null
  recommendation_accepted: boolean | null
}
```

### SessionContext
Produced by Assignment 1 → consumed by Assignment 2 to personalise the feed.
```typescript
interface SessionContext {
  current_mood_signal: string | null
  immediate_request: string | null
  session_override_active: boolean
}
```

### RecommendationResult
Produced by Assignment 2 → consumed by Assignment 1 (display) and Assignment 3 (feedback).
```typescript
interface RecommendationResult {
  title: string
  tmdb_id: string
  type: 'movie' | 'tv'
  composite_score: number
  reason_payload: ReasonPayload
  explanation: string
  is_stretch_pick: boolean
  generated_at: string
  fingerprint_version: number
}
```

---

## Key Product Decisions (do not re-debate these)

- **No forms, no surveys** — onboarding and sessions are conversational
- **Dual rating track** — quick 1–5 flip (high volume) AND deep 12-dimension survey (opt-in, low volume)
- **Stretch picks** — 1 in every 20 recommendations is intentionally outside the fingerprint. Suppressed until 15 signals exist.
- **Anti-recommendation** — stretch pick accept/reject is itself a fingerprint signal
- **Creative lineage graph** — system models director/writer influence chains, not just direct crew matches
- **Regret signal** — 48hr post-watch prompt: glad / neutral / regret. Separate fingerprint dimension.
- **Co-watch room** — 4-digit room code (not Bluetooth), real-time fingerprint intersection
- **Explainability** — every recommendation has a "Why this?" button with positive AND negative signals
- **PWA first** — no native app at MVP
- **Temporal decay** — ratings older than 18 months weighted at 50%
- **Fingerprint versioning** — last 5 snapshots stored for rollback and explanation

---

## APIs & Environment Variables

All three sessions need these in `.env.local`. Never commit this file.

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
GROQ_API_KEY=
GEMINI_API_KEY=          # voice mode (Gemini Live 2.5 Flash)
MISTRAL_API_KEY=
TMDB_API_KEY=
OMDB_API_KEY=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
CRON_SECRET=<any strong random string — shared across all three team members>
```

---

## Current Status

> ⬇️ At the end of every session, check off completed items in the **Integration Checklist** below and note anything new you discovered.

### Where we are: Integration Phase

All three modules are built and **merged into `main`**. There are no open PRs; the per-assignment `feature/*` branches are merged and deleted. The remaining work is **wiring the modules together**, which lives in shared files (`src/app/`, `src/lib/`, route handlers) — so use the short-lived-task-branch model in `GITGUIDE.md`, not long-lived personal branches.

**How to use the checklist below:** it's ordered by dependency — each block gates the ones under it. Every item names a **driver** (writes it); cross-module seams also name a **reviewer** (owns the other side and must approve the PR). A1 = Session Brain, A2 = Recommendation Engine, A3 = DNA Schema Writer. Check items off in the task PR that lands them.

---

## Integration Checklist

### 0. Unblock — environment & database · driver: Shahar · ✅ DONE (2026-07-09)
- [x] `.env.local` filled with real API keys — all 5 API providers validated by the seed run (TMDB, OMDB, Supabase service-role, Groq `gpt-oss-120b`, Mistral embed)
- [x] Ran Supabase migrations `0001`–`0006` in the SQL editor — all 8 tables + 1 view verified present
- [x] Seeded + enriched catalog: `236 titles` — **236/236 narrative-enriched, 236/236 with posters**, `1317 crew_members` (384 crew lineage graphs still pending — the nightly cron drains ~20/night; non-blocking scoring enhancer).
  - 📌 Free-tier LLM learnings (2026-07-09, measured live): Groq gpt-oss/qwen are *reasoning* models → break `generateObject` (empty `content`); Gemini free is ~20 req/**day**; **Mistral chat on the embeddings key is the enrichment workhorse** (50K TPM / 50 req-min, no daily wall). Model IDs live only in `src/lib/ai-models.ts` (`MODELS.text` = Groq chat, `MODELS.enrichment` = Mistral, `MODELS.embedding`, `MODELS.voice`).

### 1. Freeze the seams — merge contract stubs to `main` first
Land each as a tiny PR: the route handler + exact request/response types in `src/types/`, stubbed to return a mock. Once merged, both sides build against the agreed shape in parallel. Anything touching `src/types/dna.ts` needs all three to approve.
- [ ] `POST /api/dna/update-from-session` — request = `SessionSummary`, response = `{ taste_version }` · driver: A3 · review: A1
- [ ] Confirm `fingerprint_embedding_ref` upsert format between DNA writer and engine · driver: A3 · review: A2
- [ ] Confirm real-rec shape: engine `/generate` already returns `RecommendationResult` — agree the enrichment fields A1's cards read · driver: A2 · review: A1

### 2. Wire the modules — one driver each; the module owner reviews
- [x] Call `POST /api/dna/update-from-session` at chat/voice session end · driver: A1 · review: A3 — landed via `POST /api/session/end` (transcript → `analyzeSession()` → `updateSchemaFromSession()` → `generateRecommendations()`), fired by `handleRecommend` in `WTWApp.tsx`; DNA bootstrap on app load
- [x] Swap `/api/recommendations/generate` mock list for the engine's real pipeline output (UI is already shape-compatible) · driver: A1 · review: A2 — GET serves engine recs from Redis cache (with `poster_url` attached) once a session end has generated them; mocks remain only as the pre-first-session fallback
- [ ] Surface `RegretPrompt` using `getPendingRegretChecks()` · driver: A2 · review: A1
- [ ] Surface `GET /api/dna/summary` on the profile page + add a profile link to the hamburger menu — **`src/app/`, one person at a time, call it in the group chat first** · driver: A3 · review: A1

### 3. End-to-end verification — after 0–2 are green
- [ ] Full flow with real keys: bootstrap DNA → chat → session update → generate recs → verify Redis cache hit by `taste_version`
- [ ] `writeDNA` E2E with a real `SessionSummary` against a live Supabase dev instance
- [ ] Repo-wide `npm run type-check` clean — resolve the `@google/genai` module errors in `src/app/api/voice/session/route.ts` and `src/modules/session/voice/VoiceMode.tsx`

### 4. Non-blocking — independent, any time
- [ ] Generate the 30 voice WAV samples (`npm run generate-voice-samples`) over several days (Gemini free-tier 10/day); drop the `disabled` attribute on the voice play buttons once present · A1
- [ ] Voice "Recommend" handoff: re-enter the recs view with an explicit query mode once the engine exposes one · A1

**Standing handoff notes:**
- DNA Writer reads from two tables: `messages` (user role) + `recommendation_feedback`.
- "Skip calibration" maturity heuristic is `>= 10 total signals` — `MATURE_THRESHOLD` in `src/lib/welcome.ts`. Tunable.

---

## Shipped modules (reference)

> What each module delivered before the integration phase. History, not a to-do list — the live to-do list is the Integration Checklist above.

### Assignment 1 — Session Brain · merged to `main` (was PR #1)
**Last updated:** 2026-05-26
**Completed:**
- [x] Module relocated to `src/modules/session/` (commit `21433dd`)
- [x] Design port from claude.ai/design handoff
- [x] Auth flow shipped end-to-end (Supabase Google OAuth)
- [x] ESLint 9 flat config (`eslint.config.mjs`)
- [x] Text chat wired end-to-end via AI SDK `useChat`. System prompt is a calibration interview — one focused taste question per turn, no echoing, hedged fallback if user asks for a rec early.
- [x] Voice mode end-to-end via Gemini Live 2.5 (model `gemini-2.5-flash-native-audio-preview-12-2025`). Aurora background, streaming AI transcript top, live user transcript that clears when the user answers, mic-mute left / oscilloscope wave centre / X right, pause button overlays the wave during AI speech and interrupts via `player.flush()`.
- [x] Voice mode mic suppression during AI playback (no echo-bleed barge-in). Voice mode "primer" — when user taps the speaker on onboard, voice opens with Gemini reading the displayed message aloud first.
- [x] Voice picker — 30 Gemini voices with descriptors, accessible via hamburger → Set voice. Sample-preview buttons are stubbed (disabled / faded) until `public/voice-samples/*.wav` is populated via `scripts/generate-voice-samples.mjs` (free-tier quota is 10/day → run over 3 days).
- [x] **Persistence (Supabase)**: `conversations` + `messages` tables (migration `0002`). Chat + voice transcripts saved to the same `messages` stream so the DNA Writer sees a unified history. `recommendation_feedback` table (migration `0003`) captures every 👍 / 👎 click.
- [x] **Recommendations view** — accessible via the "Recommendations Ready" pill. Two view modes (compact list with infinite scroll; full-screen card with directional swipe animation). Cards use mock data shaped to match Alon's eventual `RecommendationResult` plus enrichment fields. Real TMDB poster URLs with motif/palette fallback when missing. Feedback writes to `recommendation_feedback`.
- [x] **Fast Learning** — same UI as Recommendations, opened from hamburger menu. Bulk taste-training mode; user swipes or rates 👍 / 👎. Feeds the same feedback table.
- [x] **Smart welcome (mature-fingerprint mode)** — `src/lib/welcome.ts` counts user signals (chat messages + feedback rows). When >= 10, server-side calls Groq with a system prompt seeded by time-of-day / day-of-week and returns a fresh greeting per page-load. Greeting renders as the onboard hint; rec pill always visible. Once the user interacts on the page, the greeting yields to "continue: \<last AI question\>".
- [x] **Top bar overhaul** — 3-col grid for clean centring. Brand selector toggles Movies / Series (persists to localStorage). Hamburger menu (full-bleed drawer with backdrop blur) contains user header → Fast learning → Set voice → Sign out. Message icon top-left when there's chat history.
- [x] **Welcome-loop UX** — every login + every "Back from chat/recs" lands on the onboard view. Onboard shows either the AI's last question (continue mode) or the mature greeting.

---

### Assignment 2 — Recommendation Engine · merged to `main` (was PR #7)
**Last updated:** 2026-06-29
**Completed:**
- [x] Database migrations — `titles`, `crew_members` tables + pgvector indexes (`0002`, `0003`)
- [x] TMDB client — `getMovie`, `getTV`, `getPerson`, `discoverMovies`, `discoverTV`
- [x] OMDB client — `getRatings` (normalized 0–1, RT 50% + Meta 30% + IMDb 20%)
- [x] Redis client — Upstash singleton (`src/lib/redis.ts`)
- [x] Supabase service-role client (`src/lib/supabase/service.ts`)
- [x] Enrichment pipeline — `fetchAndCacheTitle`, `enrichTitleWithNarrative`, `buildLineageGraph`, `runNightlyEnrichment`
- [x] Nightly cron routes — `POST /api/cron/enrich` (3am UTC) + `POST /api/cron/decay` (4am UTC)
- [x] Scoring components — `crew-affinity`, `narrative-match` (pgvector batch), `visceral-match`, `lineage-boost` (2-degree, batch-prefetch)
- [x] Full 8-step recommendation pipeline — Steps 1–8 in `src/modules/engine/pipeline/`
- [x] Co-watch intersection — geometric mean scoring + shared Groq explanations
- [x] Public module API — `src/modules/engine/index.ts`
- [x] API routes — `/generate`, `/cowatch`, `/explain`, `/feedback`, `/survey`
- [x] Admin seed route — `POST /api/admin/seed` (idempotent, CRON_SECRET protected)
- [x] **RecCard component** — full state machine (idle → rating → done), real `RecommendationResult` binding, feedback fire-and-forget
- [x] **WhyPanel** — inline score breakdown (5 segments), crew matches, dimension alignment, negative signals
- [x] **Reaction picker** — loved / liked / mixed / disliked on RecCard feedback loop
- [x] **RegretPrompt component** — 48-hr post-watch check-in UI; `regret-queue.ts` localStorage queue
- [x] **DeepSurvey overlay** — 12-dimension post-watch rating (7 StrandB + 8 StrandC); submits to `/api/recommendations/survey`
- [x] **GET /generate** — checks Redis cache by taste_version before falling back to mocks

---

### Assignment 3 — DNA Schema Writer · merged to `main` (PR #8)
**Last updated:** 2026-06-29
**Type-check:** `npm run type-check` is clean for `src/modules/dna/`. The only repo-wide errors (`Cannot find module '@google/genai'` in `src/app/api/voice/session/route.ts` and `src/modules/session/voice/VoiceMode.tsx`) belong to Assignment 1 — tracked in Integration Checklist §3.
**Completed:**
- [x] `src/modules/dna/init.ts` — `buildEmptyDNA(userId)` factory for new users
- [x] `src/modules/dna/signal-merger.ts` — append signals, contradiction detection, dedup
- [x] `src/modules/dna/temporal-decay.ts` — 18-month decay, 30-day run guard
- [x] `src/modules/dna/strand-a-updater.ts` — crew affinity scores + lineage boost (pure)
- [x] `src/modules/dna/strand-b-updater.ts` — narrative dimensions + Groq notes regeneration
- [x] `src/modules/dna/strand-c-updater.ts` — pacing/tone/aspect weights + aspect survey path
- [x] `src/modules/dna/learning-loop.ts` — open questions, recommendation & stretch pick history
- [x] `src/modules/dna/tmdb.ts` — TMDB credits resolution (feeds Strand A)
- [x] `src/modules/dna/embedding.ts` — Mistral embed → pgvector upsert
- [x] `src/modules/dna/snapshot.ts` — versioned snapshots, keep-last-5, rollback
- [x] `src/modules/dna/reader.ts` — `readDNA` with Upstash Redis cache + cache invalidation
- [x] `src/modules/dna/writer.ts` — orchestrator: full write pipeline, `patchRegretSignal`
- [x] `src/modules/dna/index.ts` — public API re-exports for Assignments 1 & 2
- [x] `supabase/migrations/0002_dna_snapshots.sql` — `dna_snapshots` table + `fingerprint_embeddings` UNIQUE constraint

---

## Do Not Touch List

These decisions are made. Do not refactor, rename, or redesign without team agreement.

- `src/types/dna.ts` field names and types
- The 3-branch structure
- The Supabase + pgvector + Upstash Redis stack
- The Vercel AI SDK as the orchestration layer (do not swap in LangChain)
- TMDB as the primary content metadata source

---

## Useful Commands

```bash
# Install dependencies (first time)
npm install

# Run dev server
npm run dev

# Type check
npm run type-check

# Push your branch
git push origin feature/your-branch-name

# Sync with main before starting
git pull origin main
```
