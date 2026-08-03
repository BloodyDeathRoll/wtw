# WTW — integration status & checklist

**This is the live to-do list.** Update it at the end of every session — tick off what landed and
note what you discovered. Fold the update into your task PR or a small `chore/` PR.
Shipped history is `docs/SHIPPED.md`; it is not a to-do list.

## Where we are: Integration Phase

All three modules are built and **merged into `main`**. There are no open PRs; the per-assignment `feature/*` branches are merged and deleted. The remaining work is **wiring the modules together**, which lives in shared files (`src/app/`, `src/lib/`, route handlers) — so use the short-lived-task-branch model in `GITGUIDE.md`, not long-lived personal branches.

**How to use the checklist:** it's ordered by dependency — each block gates the ones under it. Every item names a **driver** (writes it); cross-module seams also name a **reviewer** (owns the other side and must approve the PR). A1 = Session Brain, A2 = Recommendation Engine, A3 = DNA Schema Writer. Check items off in the task PR that lands them.

## ⚠️ Open now

- **Migration `0015` must be run in the Supabase SQL editor** — the co-watch IDOR fix is in code but the `cowatch_rooms` table it needs does not exist until this runs. See §3b.
- **Three seam decisions are waiting on their owners** — see §1. Each is a "keep it or retire it" call, not a bug.

---

## 0. Unblock — environment & database · driver: Shahar · ✅ DONE (2026-07-09)
- [x] `.env.local` filled with real API keys — all 5 API providers validated by the seed run (TMDB, OMDB, Supabase service-role, Groq `gpt-oss-120b`, Mistral embed)
- [x] Ran Supabase migrations `0001`–`0006` in the SQL editor — all 8 tables + 1 view verified present
- [x] Seeded + enriched catalog: `236 titles` — **236/236 narrative-enriched, 236/236 with posters**, `1317 crew_members` (384 crew lineage graphs still pending — the nightly cron drains ~20/night; non-blocking scoring enhancer).
  - 📌 Free-tier LLM learnings (2026-07-09, measured live): Groq gpt-oss/qwen are *reasoning* models → break `generateObject` (empty `content`); Gemini free is ~20 req/**day**; **Mistral chat on the embeddings key is the enrichment workhorse** (50K TPM / 50 req-min, no daily wall). Model IDs live only in `src/lib/ai-models.ts` (`MODELS.text` = Groq chat, `MODELS.enrichment` = Mistral, `MODELS.embedding`, `MODELS.voice`).

## 1. Freeze the seams — ✅ all three audited 2026-07-30 (code read on both sides, no stubs needed — every seam was already implemented)
- [x] `POST /api/dna/update-from-session` — accepts a `SessionSummary` as the body, returns `{ ok, taste_version, signal_count }` (a superset of the agreed shape), validates `session_number` + `new_signals`, and passes an optional `recommendation` through for stretch-pick history. **Note:** A1's live integration does NOT call this route — `POST /api/session/end` calls `updateSchemaFromSession()` in-process instead. The route is correct but currently unconsumed; **keep it as the external seam or retire it — A1 + A3 call.**
- [x] `fingerprint_embedding_ref` format confirmed — one row per user in `fingerprint_embeddings` (`UNIQUE(user_id)`, migration 0006) holding `{ user_id, embedding, taste_version }`, with `metadata.fingerprint_embedding_ref` = that row's `id`. Consistency is guaranteed **by construction**: `regenerate-embedding.ts` imports the engine's own `strandBToEmbeddingText`, so user and title vectors are directly comparable. ⚠️ **But the engine never reads the row** — `computeNarrativeMatchScores` re-embeds strand_b/strand_c and caches in Redis by `(user_id, taste_version)`. So the stored row is a write-only snapshot and there is one redundant Mistral embed per taste_version. Reading the row instead would be free and identical — **A2 + A3 call**.
- [x] Real-rec shape confirmed — `toUIRecommendations()` in `/api/recommendations/generate` adapts `RecommendationResult` → the UI's `Recommendation`, joining `titles` on the composite `(tmdb_id, type)`. Every field the cards read is populated **except `where`, which is hardcoded `null`** — so the "Watch on …" line never renders. Either wire TMDB watch-providers into `titles` or drop the affordance: **A2 + A1 call**. `year`/`rating` fall back to `0` when a rec has no `titles` row (theoretical for engine recs, since candidates come from that table).

## 2. Wire the modules — one driver each; the module owner reviews
- [x] Call `POST /api/dna/update-from-session` at chat/voice session end · driver: A1 · review: A3 — landed via `POST /api/session/end` (transcript → `analyzeSession()` → `updateSchemaFromSession()` → `generateRecommendations()`), fired by `handleRecommend` in `WTWApp.tsx`; DNA bootstrap on app load
- [x] Swap `/api/recommendations/generate` mock list for the engine's real pipeline output (UI is already shape-compatible) · driver: A1 · review: A2 — GET serves engine recs from Redis cache (with `poster_url` attached) once a session end has generated them; mocks remain only as the pre-first-session fallback
- [x] Surface `RegretPrompt` using `getPendingRegretChecks()` — landed by A1 (2026-07-30), not A2: rendered on the onboard view in `WTWApp.tsx`, one prompt at a time. The queue is filled when a title is rated off the watchlist (see `docs/watchlist-plan.md` §10). `onDone` now hands back the whole `RegretEntry` so the parent keys on `(tmdb_id, type)`. · review: A2
- [x] Profile page reachable — "Your taste DNA" added to the hamburger menu (2026-07-30, landed by A1), routing to `/profile/dna`. **Note for A3:** the page does NOT call `GET /api/dna/summary`; it's a server component that reads `loadDNA(user.id)` directly, which is strictly better (no extra HTTP hop, no client bundle) and already renders all three strands, contextual rules, open questions and stretch-pick results. `GET /api/dna/summary` is therefore currently unconsumed — keep it for external/API use or retire it, A3's call. · review: A3

## 3. End-to-end verification — after 0–2 are green
- [ ] Full flow with real keys: bootstrap DNA → chat → session update → generate recs → verify Redis cache hit by `taste_version`
- [ ] `writeDNA` E2E with a real `SessionSummary` against a live Supabase dev instance
- [x] Repo-wide `npm run type-check` clean (verified 2026-07-30) — the `@google/genai` module errors in `src/app/api/voice/session/route.ts` and `src/modules/session/voice/VoiceMode.tsx` no longer reproduce; the dep resolves from `package.json`

## 3b. Security — fixed, needs the migration run
- [x] **Co-watch IDOR closed** (2026-07-30) — `POST /api/recommendations/cowatch` took `user_id_b` from the request body and the engine loaded that user's DNA with the service-role client, so any authed user could read anyone's taste by guessing a user id (`room_code` was only a Redis cache key). The partner is now derived from room membership: new `cowatch_rooms` table (**migration `0015` — must be run in the Supabase SQL editor**), `POST/GET /api/cowatch/room` to open one, `POST /api/cowatch/room/join` to join, and the decision itself in `src/lib/cowatch-room.ts` (`resolvePartner`, 10 tests). No client-supplied user id remains. There is no co-watch UI yet, so nothing consumed the old contract.

## 4. Non-blocking — independent, any time
- [ ] Generate the 30 voice WAV samples (`npm run generate-voice-samples`) over several days (Gemini free-tier 10/day); drop the `disabled` attribute on the voice play buttons once present · A1
- [ ] Voice "Recommend" handoff: re-enter the recs view with an explicit query mode once the engine exposes one · A1

## Standing handoff notes
- DNA Writer reads from two tables: `messages` (user role) + `recommendation_feedback`.
- "Skip calibration" maturity heuristic is `>= 10 total signals` — `MATURE_THRESHOLD` in `src/lib/welcome.ts`. Tunable.
