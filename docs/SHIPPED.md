# WTW — shipped modules (reference)

What each module delivered before the integration phase. **History, not a to-do list** — the live
to-do list is `docs/INTEGRATION.md`.

---

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
**Type-check:** `npm run type-check` is clean for `src/modules/dna/`. The only repo-wide errors (`Cannot find module '@google/genai'` in `src/app/api/voice/session/route.ts` and `src/modules/session/voice/VoiceMode.tsx`) belong to Assignment 1 — tracked in `docs/INTEGRATION.md` §3.
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
