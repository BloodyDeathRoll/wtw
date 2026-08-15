# WTW — integration status & checklist

**This is the live to-do list.** Update it at the end of every session — tick off what landed and
note what you discovered. Fold the update into your task PR or a small `chore/` PR.
Shipped history is `docs/SHIPPED.md`; it is not a to-do list.

## Where we are: Integration Phase

All three modules are built and **merged into `main`**. There are no open PRs; the per-assignment `feature/*` branches are merged and deleted. The remaining work is **wiring the modules together**, which lives in shared files (`src/app/`, `src/lib/`, route handlers) — so use the short-lived-task-branch model in `GITGUIDE.md`, not long-lived personal branches.

**How to use the checklist:** it's ordered by dependency — each block gates the ones under it. Every item names a **driver** (writes it); cross-module seams also name a **reviewer** (owns the other side and must approve the PR). A1 = Session Brain, A2 = Recommendation Engine, A3 = DNA Schema Writer. Check items off in the task PR that lands them.

## ⚠️ Open now

- **Read the first nightly summary after the seeding fix** — see §5. `seed_attempts` vs the OMDB 1,000/day ceiling is the number that matters; `discover_pages` must not be touched until 2–3 nights of it exist.
- **Three seam decisions are waiting on their owners** — see §1. Each is a "keep it or retire it" call, not a bug.

*(Migrations `0015` and `0016` were run in the SQL editor 2026-08-14 and verified live — `cowatch_rooms` responds and `titles.last_poster_check` orders. Nothing is waiting on the database.)*

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

## 3b. Security — ✅ fixed and migrated
- [x] **Co-watch IDOR closed** (2026-07-30) — `POST /api/recommendations/cowatch` took `user_id_b` from the request body and the engine loaded that user's DNA with the service-role client, so any authed user could read anyone's taste by guessing a user id (`room_code` was only a Redis cache key). The partner is now derived from room membership: new `cowatch_rooms` table (migration `0015`), `POST/GET /api/cowatch/room` to open one, `POST /api/cowatch/room/join` to join, and the decision itself in `src/lib/cowatch-room.ts` (`resolvePartner`, 10 tests). No client-supplied user id remains. There is no co-watch UI yet, so nothing consumed the old contract.
  - Migration `0015` **run 2026-08-14** and verified against live Supabase (`cowatch_rooms` selectable; the primary key column is `code`, not `room_code`).

## 4. Non-blocking — independent, any time
- [ ] Generate the 30 voice WAV samples (`npm run generate-voice-samples`) over several days (Gemini free-tier 10/day); drop the `disabled` attribute on the voice play buttons once present · A1
- [ ] Voice "Recommend" handoff: re-enter the recs view with an explicit query mode once the engine exposes one · A1

## 5. Nightly catalog job (`scripts/grow-catalog.mts`) — ✅ seeding fix merged to `main` 2026-08-14 (#42)
Dream's overnight reviewer surfaced why nightly seeding was dying: 900/night budget, actual yield fell 523 (08-06) → 76 (08-13) with the catalog stuck at ~9.8k of 15,000. All of the below is red→green against the real script driven offline (report: `~/Projects/Dream/assignments/codebase-reviewer/reports/2026-08-14/wtw/`).

- [x] **The sweep could only reach 60 of 126 `type × genre × decade` combinations** — `type = salt % 3` and `DECADES[salt % 6]` shared a salt, so the decade *dictated* the type: no 2020s film and no 2010s/2000s/1980s/1970s series could ever be seeded. Pool was 18,000 slots, not the 37,800 the `DISCOVER_PAGES` comment claimed — under the 15,000 target after cross-genre dedup, so `growth_complete` never fired. Replaced with an explicit `SLICES` product table (126 combos, 1,890 slices). ⚠️ **1,890 is the production figure** — 126 × `discover_pages`, and Dream's `manifest.yaml` sets that to 15. The script's own default is 5, so a bare hand-run enumerates 630. Same for `discover_cap`: 400 in the manifest, 40 in the script.
- [x] **`DISCOVER_OFFSET` / `discover_next` cursor contract honoured** — Dream's `run.sh` already persisted a cursor and read `discover_next` back; the script read and emitted neither, so both halves were no-ops. `discover_next` is now `offset + slices SCANNED` (never `+ cap` — the loop breaks early on budget and the caller must not skip what it never reached). Unset/negative offset falls back to the old catalog-size anchor, so a hand-run is unchanged.
- [x] **Spend + failure counters reach the summary** — `seed_attempts`, `seed_failures`, `discover_failures`, `slices_scanned`, `slice_space`. The exit code is swallowed by design, so the summary is all the operator sees: previously "TMDB is down" and "the pool is exhausted" produced byte-identical output, and OMDB lookups spent on failed attempts were invisible (`seeded` counts successes only).
- [x] **Per-`(type, decade)` vote floor** (`VOTE_FLOOR`) — `discoverVaried` always accepted `voteCountGte` and the call site never passed it, so a flat 40 applied to 1970s Westerns and 2020s blockbusters alike. Measured live against TMDB 2026-08-14 (slices whose whole pool is under `DISCOVER_PAGES×20`): movie 1970s 7/13 short, tv 1990s–1970s 8/8 short. Floors relaxed **only** pre-2000; aggregate reachable titles ~44,988 → ~51,360 (+14%), all of it pre-2000.
- [x] **Poster backfill given the trailer backfill's rotation cursor** — migration `0016` (`last_poster_check`, run 2026-08-14), stamps every successful lookup so dead ends rotate to the back, batch size decoupled from `SEED_COUNT` via `POSTER_BACKFILL`. 📌 **Measured after applying: `poster_path IS NULL` = 0 rows.** So the claimed gain (up to 950 wasted TMDB requests/night) is **zero today** — `posters_backfilled: 0` on 19/19 nights was an empty backlog, not the re-fetch trap. Kept as insurance; costs nothing while the backlog is empty. (`trailer_key IS NULL` = 1,134 by contrast — that loop is doing real work.)

**Open — read the first night's summary:**
- [ ] `seed_attempts` vs OMDB's **1,000 lookups/day**. `seed_count` is 900 and `seed_attempts` counts failed attempts that still cost a lookup, so above ~11% failure rate the budget is blown. **This is now capped automatically** — `SEED_ATTEMPT_CAP` stops the loop at `seed_count + 10%` (990) and the summary carries `spend_capped: <cap>` on the nights it fires. Read that key, not the raw total: if it appears, the night hit a real failure rate and yield was cut on purpose. Unset derives 990; `0` means no cap at all. ⚠️ Still per-**run**, while OMDB's ceiling is per-**day** — `run.sh`'s same-day carry shrinks by titles *seeded*, not *attempted*, so two runs in one day can still exceed 1,000 between them. Fixing that half is Dream-side.
- [ ] `discover_failures` non-zero = TMDB trouble, not an exhausted pool. A failed slice now pins the cursor (`discover_next` reports the first hole, or `null` on a full outage) instead of being marked scanned, so those slices are re-read next night rather than skipped for a sweep cycle.
- [ ] **Do not touch `discover_pages`.** It has been raised twice on a dupe rate back-inferred from an assumed `pages × 20`. Take 2–3 nights and set it from these two ratios — **not** from `seeded / (slices_scanned × 20)`, which re-introduces that same assumed page size and gives the *identical* number for the two cases that want opposite moves:
  - `depth = candidates_seen / slices_scanned` — how full a page really is. Well under 20 means the pool at this depth is exhausted and more pages buy nothing.
  - `dupes = 1 - seed_attempts / candidates_seen` — how much of a full page we already hold. High, with a full depth, means deeper pages *would* hold new titles.

  The reviewer's growth model reaches 15,000 in 17 nights at 2 genres/title but lands 14,322 at 3 — the de-duplication factor decides it, and `dupes` is the first time it has been measurable.

## Standing handoff notes
- DNA Writer reads from two tables: `messages` (user role) + `recommendation_feedback`.
- "Skip calibration" maturity heuristic is `>= 10 total signals` — `MATURE_THRESHOLD` in `src/lib/welcome.ts`. Tunable.
