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
| LLM — speed (text) | Groq / Llama 3.3 70B (free tier) |
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

| Assignment | Branch |
|---|---|
| Assignment 1 — Session Brain | `feature/session-brain` |
| Assignment 2 — Recommendation Engine | `feature/rec-engine` |
| Assignment 3 — DNA Schema Writer | `feature/dna-writer` |
| Shared foundation | `main` |

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

> ⬇️ UPDATE THIS SECTION AT THE END OF EVERY SESSION

### Assignment 1 — Session Brain
**Branch:** `feature/session-brain`
**PR:** [#1 — open, awaiting review](https://github.com/BloodyDeathRoll/wtw/pull/1)
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

**In progress:**
- [ ] —

**Next session starts at:**
- [ ] Generate the 30 voice WAV samples (`npm run generate-voice-samples`) over a few days as the Gemini free-tier quota allows. Drop the `disabled` attribute on the voice play buttons once samples are present.
- [ ] When Alon's engine merges, swap `/api/recommendations/generate`'s mock list for his real pipeline output. UI is already shape-compatible.
- [ ] Voice "Recommend" handoff: today it just navigates to the recommendations view. Could re-enter with an explicit query mode once the engine exposes that.

**Cross-team handoff notes (for Eran / Assignment 3):**
- DNA Writer reads from two tables: `messages` (user role) + `recommendation_feedback`.
- Maturity heuristic for "skip calibration" is currently `>= 10 total signals` — `MATURE_THRESHOLD` in `src/lib/welcome.ts`. Tunable.

---

### Assignment 2 — Recommendation Engine
**Branch:** `feature/rec-engine`
**Last updated:** 2026-05-22
**Completed:**
- [x] Database migrations — `titles`, `crew_members` tables + pgvector indexes (`0002`, `0003`)
- [x] TMDB client — `getMovie`, `getTV`, `getPerson`, `discoverMovies`, `discoverTV`
- [x] OMDB client — `getRatings` (normalized 0–1, RT 50% + Meta 30% + IMDb 20%)
- [x] Redis client — Upstash singleton (`src/lib/redis.ts`)
- [x] Supabase service-role client (`src/lib/supabase/service.ts`)
- [x] Enrichment pipeline — `fetchAndCacheTitle`, `enrichTitleWithNarrative`, `buildLineageGraph`, `runNightlyEnrichment`
- [x] Nightly cron route — `POST /api/cron/enrich` + `vercel.json` schedule (3am UTC)
- [x] Scoring components — `crew-affinity`, `narrative-match` (pgvector batch), `visceral-match`, `lineage-boost` (2-degree, batch-prefetch)
- [x] Full 8-step recommendation pipeline — Steps 1–8 in `src/modules/engine/pipeline/`
- [x] Co-watch intersection — geometric mean scoring + shared Groq explanations
- [x] Public module API — `src/modules/engine/index.ts`
- [x] API routes — `/generate`, `/cowatch`, `/explain`, `/feedback`
- [x] Admin seed route — `POST /api/admin/seed` (idempotent, CRON_SECRET protected)

**Blocked on (needs before first real test):**
- [ ] Teammates to share API keys so `.env.local` can be filled in
- [ ] Supabase migrations `0002` and `0003` run in SQL editor
- [ ] Seed called once: `curl -X POST http://localhost:3000/api/admin/seed -H "Authorization: Bearer <CRON_SECRET>" -d '{"discover_pages":5}'`
- [ ] Assignment 3 built — feedback route has hooks ready (see commented block in `feedback/route.ts`)

**Next session starts at:**
- [ ] Integration with Assignment 1 — consume `SessionContext` from the session brain's conversation end
- [ ] Integration with Assignment 3 — uncomment `updateSchemaFromRegret` / `updateSchemaFromStretch` calls in `feedback/route.ts`
- [ ] Verify `narrativeToEmbeddingText` format matches `strandBToEmbeddingText` in `narrative-match.ts` — Assignment 3 must use the same template when generating user embeddings

---

### Assignment 3 — DNA Schema Writer
**Branch:** `feature/dna-writer`
**Last updated:** —
**Completed:**
- [ ] Nothing yet

**In progress:**
- [ ] —

**Next session starts at:**
- [ ] —

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
