# Speeding-up plan

Why the app feels slow, measured on 2026-11-05 from production logs, `pg_stat_statements` and `EXPLAIN ANALYZE`, and what to do about it, in order. Part A is done; the rest is this plan. When a part lands, move its line to `docs/INTEGRATION.md` and delete it here.

## What was measured

- **"Find more" ≈ 20 s.** The client POSTs `/api/session/end`, which runs the whole recommendation pipeline inline (a real run at 11:21: step 1 candidates **5.6 s**, step 2 scoring 1.3 s, step 4 Jev 0.1 s, watch providers 1.4 s — 8.4 s), plus a Groq transcript analysis when there were messages; then the client GETs `/api/recommendations/generate`, which makes ~7 more sequential database calls.
- **Every screen 1.5–3 s before any HTML.** The home page makes 5–6 Supabase calls in sequence (conversation, messages, feedback count, conversation list, message count, play state). Each call is ~300 ms because of where the database is.
- **Geography.** Supabase: **Sydney** (`aws-1-ap-southeast-2`). Vercel functions: Frankfurt (`region=fra1` in the runtime logs). Upstash Redis: Frankfurt. Users: Israel. A round trip function → database is ~300 ms; from a laptop in Israel 0.5–1.2 s.
- **Auth hop on every request.** `src/middleware.ts` calls `supabase.auth.getUser()` (a network call to Supabase Auth in Sydney) on every page and API request, and each page calls it again.
- **The database itself.** `get_candidate_titles_by_narrative` averaged 2.0–2.7 s per call (fixed in part A, below). The catalog is 34,973 titles against a 15k target. The instance is Supabase's smallest: 280 MB shared buffers, 2 MB `work_mem`; the 103 MB vector index does not stay in memory, so the first calls after a quiet period read it from disk (0.3–1.6 s), then ~50 ms.

## Parts

| Part | What | Effort | Expected gain | Status |
|---|---|---|---|---|
| **A** | Migration `0026`: `get_candidate_titles_by_narrative` planned per call (`return query execute`) so it uses `idx_titles_narrative_embedding`. | done | step 1: 2.0–2.7 s mean → ~50 ms warm. Verified live, e2e harness 5/5. | ✅ 2026-11-05, PR #194 |
| **B** | `getUser()` → `getClaims()` via `src/lib/supabase/auth-user.ts` (`getAuthUser`) in `src/middleware.ts`, the pages (`/`, `search`, `play`, `t/[key]`) and the three routes on the "Find more" path (`session/end`, `recommendations/generate`, `recommendations/feedback`). Measured with a real session: `getUser()` 392–399 ms every call; `getClaims()` 104 ms once (JWKS), then 0–1 ms. Completed the same day for every other API route (18 files, 22 call sites; each reads only `user.id`, the dev notice route `user.email`) and the two pages missed in the first pass (`/profile/dna`, `/login`): nothing in `src/` calls `supabase.auth.getUser()` any more. Keep `getUser()` for anything added later that must see a server-side revocation at once (account deletion, billing); `AuthUser` carries only `id`, `email`, `user_metadata`. | done | −0.4 s per page (middleware + page), −0.3–0.4 s per API call. | ✅ 2026-11-05 |
| **C** | **Corrected on inspection — nothing safe to cut.** The plan's premise was wrong: after `session/end` the client's GET is a cache hit, and when only ratings changed the precomputed batch is adopted (`adoptPendingBatch`, hash match), so there is no inline regeneration; it regenerates inline only when chat changed the taste, which is then the correct work. Moving the conversation rotation into `after()` was tried and reverted: a message sent right after "Find more" could land in the conversation being ended. The remaining "Find more" time is: 3 parallel reads (1.2 s measured), Groq transcript analysis when there was chat, the DNA update's writes, the pipeline (~3 s after A), then the GET (~1 s). The next real lever there is E. | closed | — | ✅ 2026-11-05 (no change) |
| **D** | One RPC per screen instead of 5–6 sequential queries: home (`src/lib/conversations.ts` + `src/lib/welcome.ts` `countUserSignals` + `loadPlay`), play, search. Each becomes a single `select … from rpc(user_id)`. | half a day | −1 to −1.5 s per screen while the database is far; still worth it after E (fewer round trips, fewer connections). | |
| **E** | **Move Supabase to Frankfurt** (`eu-central-1`): new project, `pg_dump`/restore (280 MB; the vector index rebuilds), re-create auth users via the admin API, rotate the keys in `.env.local` and Vercel, re-point the e2e scratch user. Needs a maintenance window. | half a day + window | every database hop 300 ms → ~2 ms; the single biggest change for "all screens load slowly". | |
| **F** | Keep the vector index warm: `pg_prewarm('idx_titles_narrative_embedding')` after deploys / nightly (the cron at `/api/cron/decay` runs at 04:00), or a bigger instance if the catalog keeps growing. | 1 h | no 0.3–1.6 s first-call penalty after quiet periods. | |
| **G** | Catalog size: decide whether 35k titles is intended (the recorded target was 15k). Fewer rows → smaller index, more of it in memory. | decision | | |

## Not recommended

- Moving the Vercel functions to Sydney (one project setting) would make the function ↔ database hop fast, but every request from Israel would then cross to Sydney (~300 ms) and every Redis call (Frankfurt) would too. Net loss for the people using the app. E is the right fix.

## How to re-measure

- Pipeline step times: Vercel runtime logs, lines `[generate] step1 candidates …`, `[generate/precompute] …` (Hobby plan keeps 1 hour).
- Database: `select calls, round(mean_exec_time), round(max_exec_time), left(query, 90) from pg_stat_statements order by mean_exec_time desc limit 12` (stats were reset on 2026-11-05 at the moment A was applied). Connect with `pg` (`npm install --no-save pg`) and `SUPABASE_DB_URL`.
- Round trips: `curl -o /dev/null -w '%{time_total}'` against `NEXT_PUBLIC_SUPABASE_URL/rest/v1/titles?select=tmdb_id&limit=1` with the anon key.
