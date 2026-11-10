# WTW v2 — execution plan

Approved by the team on 2026-11-09, from the deck "WTW engine: how it ranks and how to make it better" (8 Nov 2026).
This file is written for each teammate's Claude Code. Read all of it before claiming a work package.
The numbers and methods behind every decision are in `docs/plan/EVIDENCE.md`.

## The plan in plain words (for people; Claude, read on below)

**Why we're doing this.** We tested how well the app puts titles you like above titles you don't (the deck, 8 Nov). Three of today's six scoring parts did no better than a coin flip. On top of that, a single sentence in the chat could hide a whole genre forever: Alon's "never dramas" hid 39 titles he loved. Finally, a new user waits a whole 15-step season before getting good recommendations.

**What changes:**
1. **A new score for every title:** 30% "made by people you love", 20% "what everyone thinks of it", and 50% "your taste model". The taste model is a small per-person calculation that learns which scales (light–dark, slow–fast, …) and genres you go for. On our three accounts this took the score from 57 / 47 / 47 to 69 / 61 / 72.
2. **Every title in the catalogue gets 11 scales,** not only the 980 game titles: the 10 the games use, plus a new one, "made for kids ↔ made for adults" (it's what tells Pixar from Pooh from BoJack). That means scoring ~35,000 titles with AI, over a few nights.
3. **The chat stops changing your profile.** It's hidden for now, and comes back later as a consultant you can ask, with no effect on your recommendations.
4. **Rules only by picking:** "Never" or "Less of" + a genre from a list, and a rule hides exactly what it says.
5. **A new first run:** genres you never want → about 30 titles you've seen, rated → 12 "which would you rather watch" picks → your feed. The season stays, as an optional extra in Games.
6. **The Taste DNA page shows what really drives your feed** (Eran's task).

**In what order.** Three phases, then friends and family:
- **phase 1:** under the hood;
- **phase 2:** the new first run;
- **phase 3:** the chat as a consultant.

Phases are about what *reaches users*. Work on phase 2 screens starts during phase 1, behind an on/off switch.

**How we work without stepping on each other.** Three tracks, each with its own files and about the same amount of work: the engine; data & model (which also cuts the chat off from the profile and fixes rules); and the user front, which is Eran's: design, onboarding screens, the Taste DNA page. Every task is a GitHub issue. You claim one, build it on its own branch, and open a PR. Anything that changes recommendations stays switched off until a test tool shows it beats today on our own answers.

**Still undecided:**
- how fine the genres should be (T2, being tested now);
- what opens the chat, and whether it may add to the watchlist;
- open sign-up or invite-only for friends and family;
- whether the soft launch waits for the chat.

Every task below starts with a one-line **"In plain words"**. The rest of each task is the technical detail for Claude.

---

## 0. How to work from this file

- **Two places hold the plan:**
  - This file is the **spec**: what to build and how.
  - **GitHub Issues** hold the **status**: one issue per work package (WP), with the WP id in the title, e.g. `[P1-E3] Formula v2 in step 2`. Don't tick boxes in this file.
- **Your tasks are already assigned** (Eran, 2026-11-10). See §3a "Who does what". To pick the next one:
  1. Find your list, **in order**, in §3a. The same list is on GitHub: `gh issue list --assignee @me --state open`.
  2. Take the first task whose "Depends on" issues are all closed. If it is blocked, take the next one and say so on the blocked issue.
  3. Move its card to "In progress" on the WTW v2 board, and branch off `main`, named after the WP, e.g. `feat/p1-e3-formula-v2` (see `GITGUIDE.md`).
  4. Work phase by phase. The one planned exception is track U's design and card work, which starts during phase 1, switched off for users (§2).
  5. Reassigning a task is fine. Tell the others and change the assignee on the issue.
- **One WP is one branch and one PR.** Split a PR that grows past roughly 600 changed lines.
  - The PR body says `Closes #<n>`.
  - If the WP changes ranking, the PR body also gives the harness numbers (P1-D5).
- **Ownership.** Every WP names its module owner (A1 = Session Brain, A2 = Recommendation Engine, A3 = DNA Schema Writer).
  - CLAUDE.md's "others do not modify" rule is relaxed only for the files a WP lists.
  - A PR that touches another owner's files says so in its first line.
- **When this file and the code disagree:** the code wins on facts, this file wins on intent. Stop and comment on the issue before you build.
- **At the end of every session**, add one line per landed WP to `docs/INTEGRATION.md`, under the heading "v2 plan" (standing rule in CLAUDE.md).
- **Glossary:**
  - **season** = the 15-step play season in `/play`.
  - **learner cards** = the onboarding rating cards (loved / liked / disliked / haven't seen).
  - **this-or-that** = a pick between two titles.
  - **taste model** = the per-person ridge model.
  - **fair titles** = answered titles that are not already in the person's `dna.signals`.

---

## 1. Decisions (DEC-n) — do not re-litigate

| # | Decision |
|---|---|
| DEC-1 | **Ranking formula.** In plain words: every title's score = 30% "made by people you love" + 20% "what everyone thinks of it" + 50% "your taste model". Technically: `s = 0.30·z(creators) + 0.20·z(crowd) + 0.50·z(taste model)`. Each part is z-scored within the candidate set. Story match (narrative embedding), pace & tone (visceral), genre habits (content affinity) and recency all get weight 0. |
| DEC-2 | **Taste model.** In plain words: a small calculation per person that learns which scales and genres you go for, from your ratings and picks. Technically: a per-user ridge regression on 25 inputs (§P1-D4). It is retrained on every scoring call from the user's ratings and picks, so no weights are stored. |
| DEC-3 | **11 scales for every catalogue title** (deck option A + T2). These are the season's 10, plus **`audience`: made for kids ↔ made for adults** (decided by Eran on 2026-11-09 after the T2 test). Today only the 980 game titles have the 10, and none has `audience`. The same AI prompt as the season, plus one field, 10 titles per call. One backfill, then nightly. |
| DEC-4 | **New-user flow:** genres (guardrails) → learner cards (about 30 seen, 35–45 shown) → about 12 this-or-that → feed. The season becomes an optional extra in the Games tab. |
| DEC-5 | **Chat is a gated, ad-hoc consultant, and only a feature.** The main product is the recommendation list and the watchlist. Chat has zero effect on the brain (DNA), the rules or the ranking. Phase 1 removes every chat-made rule, preference, title signal and "tonight" modifier, and **hides the chat input** (`CHAT_MODE=off`) until phase 3. Still open: whether chat may add titles to the watchlist (leaning yes). |
| DEC-6 | **A rule hides only what it names.** "No rom-coms" ≠ "no romance". Rules are made only by people, by picking, never by the chat: "Never" in the genre step; **"Never" or "Less of"** + a genre from a list on the Taste DNA page (P1-C3); per-title Remove. **"Less of" stays** (score × 0.7). "More of" and rules about people come later (they need a `dna.ts` change). |
| DEC-7 | **Jev stays at 0.8** until P1-E7 decides keep, fix or off. |
| DEC-8 | **Launch order:** phases 1–3, then a friends-and-family soft launch. **Existing accounts are kept.** C1 step 4 cleans them. Phase-2 testing uses fresh second accounts (§P2-G). |
| DEC-9 | **No change to `src/types/dna.ts` is needed.** If a WP seems to need one, stop and raise it: it is the shared contract. |
| DEC-10 | **Match % = `composite_score × 100`**, i.e. better than X% of the titles considered. It is **capped at 97%**: never show 100%. |
| DEC-11 | **Learner cards:** stop at 30 seen or **90 shown**, whichever comes first. The 90 is under review: report the shown-to-seen ratios. |
| DEC-12 | **Onboarding card answers appear in My ratings**, like feed ratings. |

---

## 2. Phases and gates

| Phase | Goal | Gate to leave it |
|---|---|---|
| **1 Under the hood** | New formula live. Scales on every title. Chat no longer touches the brain. Rules hide only what they name. | P1-G (§4) |
| **2 First run** | Sign-up → genres → learner cards → this-or-that → first feed. | P2-G |
| **3 Chat** | Gated, read-only consultant. | P3-G → **soft launch** (§6) |
| 4 Polish | Games, recommendation list, watchlist (from `docs/BACKLOG.md`). | Not planned yet |
| 5 Features | — | Not planned yet |

**Phases are launch gates, not a strict sequence of work.**
- The user-front lane builds phase 2 screens during phase 1, behind a flag.
- Phase 3 can run alongside the end of phase 2.
- What has to wait is only what a phase *ships to users*.

---

## 3. Lanes, capacity and order

> **In plain words:** three tracks of work, each with its own files, so two people never edit the same file: the **engine** (how titles are scored), **data & model** (scoring the catalogue, building the taste model, the test tool, cutting the chat off from the profile, fixing rules) and the **user front** (design, onboarding screens, the Taste DNA page). Take a track, not a single task. The three are roughly even: about 10–13 days each.

Work splits into three lanes by file set, so two people never edit the same files. Who does what is in §3a; it follows the lanes, with two small swaps (P1-E2 to Alon early, P1-E7 to Shahar).

| Lane | Files it owns during phases 1–2 | WPs, in order | Effort* |
|---|---|---|---|
| **E — Engine** (A2) | `src/modules/engine/**`, `src/app/api/recommendations/generate/route.ts`, `src/app/components/RecCard.tsx` (match % lines only) | E1, E2 → E3 → E4 → E5 → E6 → E7 → **P1-G** → P2-U5 → phase 3 (chat), unless D frees up first | ~10 days, + ~5 for the chat |
| **D — Data & model, plus chat cut-off and rules** (A3 lead; A2 for enrichment; A1 for the session files) | `src/lib/taste-scales/**`, `src/modules/dna/taste-model.ts`, `scripts/score-catalog-scales.mts`, `scripts/eval/**`, `src/modules/engine/enrichment/nightly-enrichment.ts` (scales hook only), migrations 0029–0030; for C1/C2: `src/app/api/conversation/**`, `src/app/api/session/**`, `src/modules/session/**`, `src/modules/dna/update-from-session.ts`, `src/lib/exclusion-rules.ts`, `scripts/strip-chat-from-dna.mts` | D1 → C1 → D2 (overnight runs; C2 fits in the waits) → C2 → D4 → D3 → D5 → P2-U7 | ~11–13 days, plus nights of calls |
| **U — User front** (A3 games/page; Eran) | `src/app/play/**`, `src/app/onboarding/**` (new), `src/app/profile/dna/**`, `src/app/api/dna/rules/**`, `src/app/api/dna/taste/**` (new), `src/app/api/onboarding/**` (new), `src/app/page.tsx` | U0 (**Eran**, design) → U1 → C3 → U2 → U3 → U4 → U6 → U8 (**Eran**) → P2-G | ~11–13 days, including design rounds |

\*Effort means one person working with Claude Code. S ≤ 1 day, M = 2–4 days, L = 5+ days. These are guesses, not commitments.

**Critical path:** D1 → D2 → D4 → E3 → E6 → P1-G → U5 → P2-G.

```
week 1:  E: E1 E2 ── E3 (on the 980 titles) ── E4      D: D1 ─ C1 ─ D2 probe+backfill(nights) ─ C2   U: U0 design ─ U1 ─ C3
week 2:  E: E5 ── E6 (needs D2 done) ── E7             D: D4 ─ D3 ─ D5 ── P1-G numbers            U: U2 ─ U3 ─ U4 (flag off)
week 3:  E: P1-G flip ── U5 ── P3 (chat)               D: U7 reset tool, R3 retest                 U: U6 ── U8 ── P2-G
week 4:  P3-G ── soft launch
```

**Should the learner cards and this-or-that be ready ahead of time? Yes. Build them in phase 1, behind `ONBOARDING_V2`.**
- They only write data the engine already reads:
  - ratings go to `dna.signals`;
  - picks go to `play_events` with kind `duel`.
- Only U5 (first feed) and the phase-2 gate need the new formula.
- If lane U waits, it sits idle for about two weeks while the critical path sits in lanes E and D.

Phase 3 (chat) goes to whichever of lanes E or D frees up first after P1-G. It is session code, so it fits A1's owner. It owns `src/app/api/conversation/**`, which C1 (lane D) has already emptied of DNA writes.

**Why the split looks like this** (Eran, 2026-11-09): C1 and C2 moved from U to D. They are pure engineering, they touch A1's session code, and they are needed before the phase 1 gate, so they shouldn't wait behind design rounds. Lane U keeps the design and UI work. E and D carry the critical path; U has slack until P1-G.

### 3a. Who does what (Eran, 2026-11-10)

The issues are assigned to match this. Shahar = `BloodyDeathRoll` (A1), Alon = `booster212` (A2), Eran = `eran-manor` (A3).

| | Phase 1 — in this order | Phase 2 | Phase 3 |
|---|---|---|---|
| **Shahar** (~22 days) | #227 P1-D1 scales setup → #230 P1-D4 taste model → #235 P1-C1 chat cut-off → #228 P1-D2 catalogue scoring (runs at night) → #236 P1-C2 rules fix → #238 P1-D5 test tool → #239 P1-E7 Jev keep/fix/off | #248 P2-U7 reset tool; reviews #244 (the ratings path) | All of it: #251–#255, and the gate #256 |
| **Alon** (~16 days) | #225 P1-E1 crowd fix → #226 P1-E2 Jev input bugs → #231 P1-E3 new formula → #232 P1-E4 downstream → #233 P1-E5 "Why this?" → #234 P1-E6 step 1 by taste → #229 P1-D3 nightly scales → **drives #240 P1-G** (switch the formula on) | #246 P2-U5 first feed | — |
| **Eran** | #237 P1-C3 rules dropdown | #241 P2-U0 design → #242 P2-U1 card set → #243 P2-U2 genre screen → #244 P2-U3 cards → #245 P2-U4 this-or-that → #247 P2-U6 routing → #249 P2-U8 Taste DNA → **drives #250 P2-G** | — |

**Why:**
- **Each person gets their own module where possible:** the chat and session code is A1, Shahar's; the engine is A2, Alon's.
- **Shahar takes the larger share and the precision work:** the taste model, and the test tool that referees everyone's numbers. Jev is his too: he built it.
- **Alon is never idle.** His formula (#231) waits for #227 and #230, so his first days go to #225 and #226. Agree `trainTasteModel`'s signature with Shahar on day 1, so #231 can be built against it before #230 lands.

**Reviews on two-domain tasks:**
- Alon reviews the database part of #227.
- Eran reviews the DNA files in #235 and #255.
- Shahar reviews the ratings path in #244.

**Gates:**
- #240: Alon drives it, Shahar supplies the test-tool numbers.
- #250: Eran drives it, all three test.
- #256: Shahar.

---

## 4. Work packages

The format of each entry: **ID · title** — owner · lane · size · deps · flag.

### Phase 1 — under the hood

**P1-E1 · Crowd-score fix** — A2 · E · S · deps: none · no flag
> **In plain words:** When a title is missing one of its two outside ratings, the app wrongly halves its crowd score, so good titles sink. Fix the arithmetic.

- **File:** `src/modules/engine/pipeline/step2-composite-score.ts` → `externalRatingScore`.
- **Bug:** when a title has only one of its two ratings, it returns `(omdb/0.4)*0.5` or `(tmdb/0.6)*0.5`, which halves the score. This hits 48 of the 923 tested titles.
- **Fix:**
  - TMDB only → `tmdb_rating/10`.
  - OMDB only → `omdb_rating`. It is stored 0–1; do not divide it by 10.
  - Both → unchanged (`0.6·tmdb/10 + 0.4·omdb`).
- **Done when:** a unit test covers the 3 cases. It ships live at once.

**P1-E2 · Jev input bugs** — A2 · E · S · deps: none
> **In plain words:** Jev, the last filter that drops titles you'd probably dislike, is told the wrong things about you. It never hears your favourite directors, and it's told you "rated down" genres you actually like. Fix what it's told.

- **File:** `src/modules/engine/pipeline/step4-llm-rerank.ts`.
- **(a) Favourite crew is almost always empty.**
  - `profileSummary` filters `e.score > 0.3`, but a strand A `score` is a running average reaction level that tops out at +0.30 (`src/modules/dna/lib/reaction-score.ts`).
  - Fix: keep entries with `score > 0` and `sample_size ≥ 2`, sort by `score × confidence`, take the top 5.
- **(b) "Rated down" counts the wrong thing.**
  - `avoidSummary` prints `${e.sample_size} rated down`, but `sample_size` counts every rating of that genre, not the dislikes.
  - Fix: print the key only, and include only entries with `score ≤ −0.10` and `sample_size ≥ 3`. State the thresholds you pick in the PR.
- **Check:** the text for one tester reads correctly in `scripts/jev-threshold-probe.mts`.
- **Done when:** unit tests cover both strings.

**P1-D1 · Scale module + schema** — A3 lead (the scales are the season's), A2 reviews (titles table) · D · M · deps: none
> **In plain words:** Get ready to give every title in the catalogue 11 scales: the 10 the games use (light–dark, slow–fast…) plus "made for kids ↔ made for adults": one shared copy of the AI's instructions, fixed rules for turning its answers into scale values, and new columns in the database.


1. **Move the shared parts** into `src/lib/taste-scales/prompt.ts`, verbatim. Then add the `audience` line to the catalogue prompt only (the season builder doesn't use it):
   - `audience: -5 made for young children (preschool) ... 0 for everyone, all ages equally ... +5 strictly for adults (mature themes, violence, sex, language, adult humour). Animation is not automatically for kids.`
   - Reference points (the ones used in the T2 test): Peppa Pig (series) −5, Frozen −3, Toy Story −2, Spirited Away −1, LOTR: Fellowship +1, The Dark Knight +2, BoJack Horseman (series) +4, South Park (series) +4, The Wolf of Wall Street +5.
   - Add `audience` to `SCALE_LABELS` (`For kids` / `For adults`) and to `SCALE_WORDS` (`kid-friendly` / `grown-up`) in `src/app/play/lib/scales.ts`, so the Why lines and the Taste DNA page can use it.
   - The parts to move: `SCALE_GUIDE`, `batchSchema`, `titleLine`, `repairBatch` from `scripts/build-play-titles.mts`. Make `build-play-titles.mts` import them.
   - Check: re-running it with the existing cache yields a byte-identical `src/app/play/data/titles.json`.
2. **Write `src/lib/taste-scales/normalise.ts`** with frozen constants. Derive them once with `scripts/derive-scale-norms.mts` from `src/app/play/data/ai-scores.json` (raw −5..5) and `titles.json`.
   - **AI scales** (`tone, energy, pace, dark, complex, fantastic, humor`): `v = round2(clamp((raw − mean)/(1.5·sd), −1, 1))`.
     - `mean` and `sd` are the population stats over the 980 set's carriers, which is exactly what `spread()` in `src/app/play/lib/scales.ts` does.
     - `humor` applies only when the title's game genres include `comedy`.
   - **`modern`:** the rank of `release_year` against the 980 set's sorted years, mapped to −1..1. Interpolate linearly between ranks and clamp outside the range (this matches `rankSpread`).
   - **`indie`:** −(the rank of log10(`tmdb_vote_count`) among the 980 titles of the same type). Titles below the set's minimum get +1.
   - **`commit`:** series with a known episode count only. The rank of the episode count among the 980 set's series.
   - **`audience`** (new, AI-judged): same `spread()` rule as the other AI scales, with the mean and sd taken over the 980 set once it is scored. It applies to every title.
   - **The 980 game titles keep their `titles.json` scales verbatim.** Those include the `title-fixes.json` overrides, so the season and the model agree. They have no `audience` yet: D2 scores it for them, about 98 calls.
   - Check: the script prints every title where normalise(raw) differs from `titles.json` by more than 0.01. Only override titles may differ.
3. **Write `src/lib/taste-scales/features.ts`.** It holds `TASTE_FEATURE_VERSION = 1` and `tasteFeatures(row) → number[25]`, in this fixed order. The count is 25 (the 11th scale is decided). The finer genre tags are **not** model inputs for now (T2 result).
   - `[0]` rating: `clamp((tmdb_rating − 7.6258) / 0.6436, −3, 3)`; a null rating → 0.
     - The mean and sd are those of the 980 set.
     - The clamp is **new** compared with the tests: catalogue ratings go down to about 2. It is checked in R3.
   - `[1..13]` game genres, sorted: `action, anim, anime, comedy, crime, doc, drama, family, horror, romance, scifi, thriller, war`. Each of the title's n genres gets `1/n`; the rest get 0.
   - `[14..23]` scales, sorted: `commit, complex, dark, energy, fantastic, humor, indie, modern, pace, tone`. A missing scale → 0.
   - `[24]` `audience`, appended last so indices 0–23 match the tested recipe (EVIDENCE §R).
   - Game genres for titles outside the 980: `candidateGenres(row).firm` ∪ (`hinted` ∩ the AI's `confirmed`), as in `build-play-titles.mts` and `src/app/play/lib/genres.ts`.
4. **Migration `0029_title_taste_scales.sql`:**
   - On `titles`, add: `taste_raw jsonb` (AI −5..5 per AI scale plus `confirmed`), `taste_scales jsonb` (final −1..1), `game_genres text[]`, `taste_vec vector(25)`, `taste_version smallint`.
   - Use the same pgvector schema as `0018_titles_halfvec.sql`.
   - Index: try an exact scan first. 35k × 25 floats should take well under 50 ms. Add HNSW `vector_ip_ops` only if `EXPLAIN ANALYZE` says you need it.
- **Done when:** `type-check` passes, the derive script is committed, its output is clean, and the migration has been run and verified live.

**P1-D2 · Catalogue backfill** — A2 (enrichment) lead · D · M plus overnight runs · deps: D1
> **In plain words:** Score all ~35,000 titles on the scales: a few thousand AI calls, spread over several nights. First, measure how fast the free AI account lets us go.

1. **Quota probe first.**
   - Make 20 real calls with `MISTRAL_BATCH_API_KEY` through `src/lib/mistral-batch.ts`.
   - Log latency, 429s and any rate-limit headers.
   - Compute calls per night, without starving the nightly enrichment (`MISTRAL_CALL_BUDGET` 600 per night today).
   - Write the result on the issue. The deck flagged this as unchecked.
2. **Run `--finalise` for the 980 game titles first.** It needs no AI calls, since their values come from `titles.json`, and it lets E3 and D4 start on real `taste_vec` rows.
3. **Write `scripts/score-catalog-scales.mts`:**
   - Resumable: skip titles where `taste_raw` is not null.
   - Order: most-voted first, and every title with 300+ votes before the rest.
   - 10 titles per call, using `MODELS.enrichment`. Model ids live only in `src/lib/ai-models.ts`.
   - Follow the 429 cooldown rule from INTEGRATION.md "1c": a cooldown, then retry the same item; three in a row = stop.
   - Flags: `--dry-run`, `--limit`, `--budget`.
   - A `--finalise` pass computes `taste_scales`, `game_genres`, `taste_vec` and `taste_version` for every row that has `taste_raw`. The 980 game titles take their `titles.json` values.
   - Episode counts for `commit`: one TMDB call per series where missing (8,229 series). Cache the counts on the row.
4. **The run includes the 11th scale, `audience`** (decided 2026-11-09). It is one more field in the same call, so it costs no extra calls. Also score `audience` for the 980 game titles, which don't have it yet.
5. **Run it** until every title has `taste_raw` (~35k titles, ~3,500 calls).
6. **QA:**
   - Show Eran 30 random titles under 5,000 votes, with their 11 scales in words (`SCALE_WORDS`), to sanity-check.
   - Compare the scale distributions with the 980 set: means within ±0.2 is fine; anything else gets flagged.
- **Done when:** 100% of titles with ≥300 votes have `taste_vec`, and the counts are posted on the issue.

**P1-D3 · Nightly scales** — A2 · D · S · deps: D2
> **In plain words:** From then on, the nightly job scores the ~60 new titles that arrive each day.

- Hook into `src/modules/engine/enrichment/nightly-enrichment.ts`, after narrative enrichment and inside the same call budget: score new titles 10 per call, then finalise.
- Also recompute `taste_vec` for rows whose `tmdb_rating` changed. The rating input moves.
- Report `scales_scored` in the run report that `grow-catalog.mts` prints, so the Dream digest shows it.

**P1-D4 · Taste model library** — A3 · D · M · deps: D1 (features)
> **In plain words:** Build the taste model itself: a small calculation that looks at everything you rated and picked, and learns which scales and genres pull you in and which push you away. It's recalculated on every rating, in a split second.

- **File:** `src/modules/dna/taste-model.ts` (pure), plus `tests/unit/taste-model.test.ts`.
- **`trainTasteModel(rows, pairs) → w (25)`:**
  - **Rows:** `dna.signals` with reaction `loved | liked | disliked` → levels 3 / 2 / 1.
    - **Exclude `source` matching `session_*`.** Those are titles named in chat (DEC-5).
    - Include only titles that have a `taste_vec`.
  - **Weight:** 0.5 for a rating older than 18 months (the temporal-decay rule in CLAUDE.md), else 1. If no reliable rating timestamp exists, use 1 and say so in the PR.
  - **Target:** `y_i = level_i − (weighted mean of levels)`.
  - **Pairs:** `x = x_chosen − x_other`, `y = +1.0`, weight 1.
  - **Solve** `(XᵀWX + Λ) w = XᵀWy` with `Λ = diag(0.5, 4.0 × 24)`, no intercept, by Cholesky or Gaussian elimination on 25×25.
  - Zero rows and zero pairs → `w = 0`.
- **`predict(w, x) = w·x`.**
- **`contributions(w, x) = w_k·x_k` per input,** for the Why lines (E5).
- **Loader `loadTasteTraining(dna, userId)`:**
  - The signals.
  - `play_events` where `kind = 'duel'` and `payload.chosen` is set. That covers season duels and onboarding picks alike; the payload is `{a, b, axis, chosen}` (built by `duelEvent` in `src/app/play/components/PlayApp.tsx`).
  - Fetch `taste_vec` for all the keys in one query.
- **Optional:** a Redis memo keyed by user + `taste_version`.
- **Done when:**
  - A unit test on a fixture of about 40 titles matches the reference recipe (EVIDENCE §R) to 1e-6. Write the expected values with a tiny numpy snippet kept as a comment in the test.
  - With labels shuffled, the harness lands at about 50.

**P1-E3 · Formula v2 in step 2** — A2 · E · M · deps: D1, D4 · flag `FORMULA_V2`
> **In plain words:** Switch the score to the new recipe (creators 30%, crowd 20%, taste model 50%) and drop the three parts that tested no better than a coin flip. It sits behind an on/off switch and stays off until it passes the tests.

- **File:** `step2-composite-score.ts`, plus `src/modules/engine/types.ts` for the new fields.
- **With the flag on:**
  - Load the training data once per call and train `w`.
  - **Per candidate:**
    - `creators` = today's crew + lineage score, unchanged.
    - `crowd` = `externalRatingScore` (after E1).
    - `model` = `w·taste_vec`. A missing vector → the pool mean, so its z is 0.
  - **Z-score each part** within the candidates (population sd; sd = 0 → all zero).
  - `s = 0.30·zc + 0.20·zw + 0.50·zm`.
  - **`composite_score = Φ(s / sd(s))`** (standard normal CDF; sd = 0 → 0.5).
    - This keeps the composite in (0,1), so the step-3 multipliers, step 5's `< 0.4`, co-watch's `sqrt(a·b)` and the match % all keep working.
    - It now reads as "better than X% of this pool".
  - **Skip `computeNarrativeMatchScores`** (weight 0). That saves one pgvector RPC per generate. Set `narrative_match_score = 0.5`.
  - Keep computing the visceral and content results **only** for `dimension_matches` until E5 replaces them. Their weight is 0.
  - Store `zc, zw, zm` and the model score on `ScoredTitle`, for the Why lines and debugging.
- **Done when:**
  - Unit tests cover the z-scores and Φ.
  - The harness (P1-D5) shows v2 above the thresholds in P1-G.
  - It can be developed and tested before D2 finishes, on testers' ratings among the 980 titles that already have scales.

**P1-E4 · Downstream of v2** — A2 · E · S–M · deps: E3
> **In plain words:** Make everything that reads the score work with the new one: the match % on cards (capped at 97%), "Less of", stretch picks and co-watch. Remove the chat's "tonight" settings.

- **Match %:**
  - `src/app/api/recommendations/generate/route.ts`, `MATCH_DISPLAY_CEILING = 0.8`: under v2, `match = min(composite_score, 0.97)` (DEC-10). The composite is now a pool percentile.
  - Since the feed is the top of the pool, expect most cards to read 85–97%. Report the actual spread on the PR.
  - `src/app/components/RecCard.tsx` L291–304 fakes narrative/visceral from the composite, and `noClaim` triggers at composite ≤ 0. Check that both still read correctly. Cold start still emits 0, so `noClaim` still fires there.
- **`step3-soft-modifiers.ts`:**
  - Delete the temporal-modifier block. Only chat wrote `temporal_modifiers` (DEC-5).
  - **Keep the soft-preference block**: it is "Less of" (DEC-6). `composite_score` stays in (0,1) under v2, so `× weight_modifier` still means "sink it". Its matching must follow C2: exact genre only (`matchesSoftSignal`).
- **`step5-stretch-pick.ts`:** keep `MAX_COMPOSITE_SCORE = 0.4` (= the bottom 40% of the pool). Check that a stretch pick still appears 1 in 20 and stays suppressed below 15 signals.
- **`cowatch/intersection.ts`:** `sqrt(a·b)` stays valid on (0,1). Check it on one room.
- **No cache key change is needed.** `taste_version` already bumps on each rating.

**P1-E5 · "Why this?" from v2** — A2 · E · M · deps: E3, D4
> **In plain words:** Keep the friend-style "Why it's a match" text as it is, but feed it facts from the new formula (your scales and genres) instead of the parts we drop. The sheet's bars become Your taste, Crowd and Creators.

- **Product rule:** every recommendation shows positive **and** negative signals.
- **What already exists and stays as is:** the written "Why it's a match" (`src/modules/engine/why/write-why.ts`, live since 2026-11-06; see INTEGRATION.md "one opening angle per title"):
  - one paragraph of 80–140 words, written by a Groq model from facts only, then fact-checked;
  - one opening angle per title (`angleFor`): a person link, a title you loved that shares story ground, the cast, the feel, the premise, or a comparison ("*X* meets *Y*", allowed only on the comparison angle);
  - banned overused words (`OVERUSED`);
  - one honest catch (`reservationFor`);
  - a fact-built fallback.
  **E5 changes the facts it's fed, not the writer.**
- **Today the facts come from parts v2 drops:**
  - the "personal" lines in `buildWhyFacts` (shared tones, a genre "rated highly", pace) read `dimension_matches` from the visceral and content scorers;
  - `reservationFor` reads `tone_weights` / `pacing_weights` (strand C) and `content_avoided`;
  - `step6-reason-payload.ts` builds its negatives from `narrative < 0.45` / `visceral < 0.4`.
- **v2 facts** (from `contributions()`, P1-D4):
  - **Personal lines:** the top 2 positive contributions among the scale and genre inputs, said as what the viewer goes for.
    - "This viewer goes for light, down-to-earth stories, and this one is both."
    - "Crime is a genre this viewer goes for."
    - Scale words come from `SCALE_WORDS` in `src/app/play/lib/scales.ts`.
  - **The catch** (`reservationFor`): the most negative contribution, if it is below −0.05.
    - "It's more mainstream than this viewer usually goes for." / "It's darker…" / "It's talkier…"
    - Keep the language catch and the 2.5-hour catch.
    - Drop the strand-C ones.
    - **Say it plainly** (Eran, 2026-11-09: "we shouldn't be afraid of saying that").
  - **Step 6 negatives:** `zm < −0.5` → the most negative contribution; `zw < −1` → "rated lower than what this viewer usually picks".
  - **Creators** (person links, angles): unchanged.
  - **No crowd or critics talk in the text** (the 2026-11-06 rule). The crowd shows in the bars.
- **The sheet** (`WhyPanel` in `src/app/components/RecCard.tsx`):
  - **Score breakdown = three real bars:** **Your taste · Crowd · Creators**, each `Φ(z)`, with Creators last (backlog row "what the Crew bar means"). They replace Crew / Narrative / Mood & pace / Reviews / Recency, two of which were guesses (backlog row "two of the five bars are guesses").
  - **"What it's like":** the title's clear scale ends (|value| ≥ 0.5) in `SCALE_WORDS`, plus genre and language.
- **The output is one paragraph,** with the catch woven in as its last sentence. No bullet lists.
- **Bump the why cache** (`why_ai:v5`).
- **No invented facts.** Every claim must come from these numbers or from database fields.
- **Done when:** the full text of 10 sheets for one tester is posted on the PR, written by the real writer, and Eran has reviewed it.

**P1-E6 · Step 1 picks by taste** — A2 · E · M · deps: D2 done, D4 · flag `FORMULA_V2`
> **In plain words:** Today half of the first titles a new user sees are simply the most popular ones, which most people have already seen. Add a second source: titles the taste model says fit you, lesser-known series included.

- **Migration `0030_candidate_by_taste.sql`:** `get_candidate_titles_by_taste(user_w vector(25), exclude_keys text[], …)`.
  - Copy the rule parameters and the content-type parameter from `get_candidate_titles_by_narrative` (migration 0026), plus `min_votes_movie int, min_votes_tv int, pool_limit int`.
  - Order by `taste_vec <#> user_w`. pgvector's negative inner product means ascending order = best first.
- **`step1-candidate-gen.ts`, under the flag:**
  - Replace the narrative pool with the taste pool: over-fetch ×`NARRATIVE_OVERFETCH`, then `capGenreShare`, as the narrative pool does today.
  - Keep the 150 most-voted titles and the SEEN pool.
  - Skip the taste pool when `w = 0`.
- **Vote floors, as a starting point:** movies 1,000, series **300**. Today only 545 series clear 1,000, against 4,613 movies. Tune them in R3.
- **Pool mix:** start at 150 most-voted + 150 by taste. If R2 shows the first feed is still mostly titles people have already seen, move to 100 + 200.
- **Done when:** the harness passes, and R2 has been measured on a live account.

**P1-C1 · Cut chat off from the brain** — A1 lead (session), A3 for the dna files · D · M · deps: none · ships live
> **In plain words:** Hide the chat for now, and cut every way it changed your profile: rules it saved from a sentence, titles it picked up, "tonight" moods. Clean out what it already saved, and show each person a list, so they can re-add what they really meant.

0. **Hide the chat input** behind `CHAT_MODE=off` (DEC-5). Look for it in `src/modules/session/components/WTWApp.tsx` and in the home screen's input bar. Nothing else in the UI should point to the chat while it is off.
1. **`src/app/api/conversation/message/route.ts`:**
   - Delete the `extractDirectivesFromText → applyDirectives → saveDNA` block (around L112–130).
   - Change the system prompt so the chat never claims it has saved or remembered anything.
2. **`src/app/api/session/end/route.ts`:**
   - Don't call `analyzeSession`. That saves one Mistral call per session.
   - Keep folding card ratings (`src/modules/session/feedback-signals.ts`, source `recommendation_accepted`) and keep the conversation rotation.
   - Pass a summary with no `new_signals` and no `directives`, or call a narrower merge.
3. **`src/modules/dna/update-from-session.ts`:** stop applying `summary.directives` and transcript signals.
   - `src/app/api/dna/update-from-session/route.ts`: if nothing calls it, delete it.
4. **Data:** run `scripts/strip-chat-from-dna.mts` (new, dry-run by default) per user:
   - First, `snapshot.ts`.
   - Then remove:
     - `temporal_modifiers` (all);
     - `soft_preferences` (all). Chat-made and typed ones can't be told apart either, so they are listed for re-adding with P1-C3, like the rules;
     - `exclusion_rules`, except the ones the games own (`play-marker.ts`). Rules typed on the Taste DNA page can't be told apart from chat-made ones (both go through `applyDirectives`), so they go too. The dry run lists every removed rule per user, so each person can re-add the ones they meant with P1-C3;
     - signals with `source` `session_*` (titles named in chat).
   - Then rebuild the strands from the remaining signals (`rebuild-strands.mts` logic) and bump `taste_version` and `last_updated`.
   - Run it before the testers judge the new formula. Otherwise old rules such as Alon's "never dramas" still hide titles they love.
5. Leave `analyze-session.ts` and `directive-patterns.ts` unused. P3-5 deletes them.
- **Done when:** a unit test shows that a message like "no horror" changes nothing in the DNA, and `type-check` passes.

**P1-C2 · Rules hide only what they name** — A3 + shared `src/lib` · D · S–M · deps: C1
> **In plain words:** Make rules hide exactly what they say. Today "no rom-coms" hides all romance, and "no musicals" hid Whiplash.

- **File:** `src/lib/exclusion-rules.ts` (`ALIASES`, `ruleTargets`, `matchesRule`, `sqlExclusionParams`, `matchesSoftSignal`).
- After v2, rules come only from a genre "Never" or "Less of": in the genre step (Never only), or on the Taste DNA page (P1-C3). Remove is per title and isn't a rule. The same exact-genre rule applies to "Less of".
- **Change:**
  - A genre rule matches that exact TMDB genre set only. Use the game genre → TMDB mapping in `src/app/play/lib/genres.ts`.
  - Remove the alias widening (rom-coms → romance, musicals → music, cartoon → animation).
  - Keep `anime` = Animation + Japanese, because the genre step offers it.
  - A keyword rule matches TMDB keywords exactly, never genre names.
- Update `tests/unit/exclusion-rules.test.ts`.

**P1-C3 · Taste DNA: "Never" / "Less of" + a genre picked from a list** — A3 · U · S–M · deps: C2
> **In plain words:** On the Taste DNA page, adding a rule means picking "Never" or "Less of" and a genre from a list. No typing, and no two rules on one genre.

- **Source:** `docs/BACKLOG.md`, the Taste DNA redesign entry, its "Add a rule" part. Mocks are in `docs/prototypes/taste-dna/`; Eran approves the state before it is built.
- **Files:** `src/app/profile/dna/RulesSection.tsx`, `src/app/api/dna/rules/route.ts`.
- **The new "Add a rule":**
  - **The first dropdown: "Never show me" · "Less of".** "More of" and rules about people (creators) come later and are not built now. "More of" needs a `dna.ts` change.
  - **The second dropdown is a closed list:** the 13 game genres (`GAME_GENRES` in `src/app/play/lib/genres.ts`), the same list as the genre screen.
  - **A genre that already has a rule is greyed out**, whatever made the rule (the genre step or this page).
  - **The typing box goes.**
- **Server:** `POST /api/dna/rules` accepts only a game genre id and the intent `never` or `less`. Anything else gets a 400.
  - `never` saves a `genre` exclusion rule.
  - `less` saves a soft preference with `target_type: 'genre'` and `weight_modifier: 0.7`.
  - Both follow C2's semantics.
- This is the bare minimum. P2-U8 restyles it into the redesigned page.

**P1-D5 · Eval harness** — A2 + A3 (shared scripts) · D · M · deps: none to start; E3 to evaluate v2
> **In plain words:** A test tool in the repo that runs the same checks as the deck on each tester's own answers, so every change to ranking comes with numbers. The answers stay on each person's own computer.

- **Code:** `scripts/eval/` (committed).
- **Data:** `.eval-data/` (**gitignored, never committed**: the repo is public).
  - One file per tester: `{ "movie:603": "loved" | "liked" | "disliked" | "unseen", … }`.
  - Eran holds the existing sheets locally and sends each tester their own file privately.
  - The user id comes from an argument. Never put an email in the repo.
- **Metric:** pairwise concordance over pairs at different levels, ties count half. L/D = loved-vs-disliked pairs only. Also the share of loved and of disliked titles among the top 5 of 20.
- **Modes:**
  - **(a) live:** run the real step 2 code, v1 and v2, on the tester's live DNA, over fair titles. Reproduces the deck's "parts" and "formula" slides.
  - **(b) new user:** start from a blank DNA. Take N cards (random, or the P2-U1 order) plus K picks (the tester's own `duel` events, in order). Score 20 hidden fair titles, over 200 draws. Add a random-answer control. Reproduces "howmany", "thisorthat" and "firstuser".
  - **(c) jev:** the top half of each ranking → step 4 at 0.7 / 0.8 / 0.9. Report dislikes caught and loved titles lost. This costs Typesafe calls, so cap them.
- **Trust check:** reproduce v1 "engine today" (57 / 47 / 47) to within ±3 first. The DNAs have moved since 7 Nov.

**P1-E7 · Jev: keep, fix or off** — A2 · E · S · deps: E2, E3, D5
> **In plain words:** Re-test Jev on top of the new formula and decide: keep it, make it stricter, or switch it off.

- Run mode (c) on v2.
- Apply the rule from the deck:
  - If Jev at 0.8 drops more loved titles than disliked ones → set `JEV_ENABLED=false` (skips step 4).
  - Or use 0.9 if, at 0.9, it loses ≤ 1 loved per disliked caught and catches ≥ 30% of dislikes.
- Log the numbers in INTEGRATION.md.

**P1-G · Gate: switch on `FORMULA_V2`** — the lane E driver, reviewed by all
> **In plain words:** The moment we switch the new formula on for real: only when the numbers pass for all three of us and the app isn't slower.

- **Preconditions:**
  - D2 is done.
  - E3–E6 are merged.
  - C1 and C2 are live.
  - E7 is decided.
- **Numbers from harness mode (a)** on fair titles (realistic floor = the deck's number − 3 for noise):

  | Tester | Concordance at least (deck) | L/D at least (deck) |
  |---|---|---|
  | Eran | 66 (69) | 78 (81) |
  | Shahar | 58 (61) | 64 (67) |
  | Alon | 69 (72) | 80 (83) |

  v2 must also beat v1 for every tester.
- **Latency:** the `[generate]` timing p50 must be no more than 20% above today's.
- **After the switch:** each tester regenerates, reacts to 20 feed cards, and notes their impressions in INTEGRATION.md.

### Phase 2 — first run (sign-up → onboarding → first recommendations)

The screen designs come from `docs/prototypes/first-run/` (genres, learner 2a/2b/2c, this-or-that, feed). Eran approves each state as a JPEG before it's built.

**P2-U0 · Design: the learner cards and the this-or-that rules** — **Eran** — product/design · U · M · deps: none (starts now)
> **In plain words:** before anything in phase 2 is built, Eran and Claude finish the design of the rating cards (how a card looks and behaves) and refine the this-or-that rules (how pairs are chosen and shown). The builders build what comes out of this.

- **Cards (design):**
  - Mocks so far are in `docs/prototypes/first-run/` (2a / 2b / 2c learner, from the mocks session of 2026-11-09).
  - Output: one approved JPEG per state (memory rule: one JPEG per state, rendered and checked).
  - Open in design: which of 2a / 2b / 2c; how "haven't seen" looks; progress toward 30; what happens at the 90 cap.
- **This-or-that (rules):**
  - Starting point: the season's picker (`nextPair` in `src/app/play/lib/brain.ts`), which produced the measured gain (+12 picks = +3 / +7 / +3, EVIDENCE §5).
  - To refine: how many picks, what a pair may contain (both seen? either?), whether "can't choose / haven't seen either" exists, and the pool (the 980 titles minus "never" genres).
  - **Any change to the pair rules is checked with the harness (P1-D5, mode b)** before it is built. The +7 for Shahar came from these rules.
- **The genre list:** settle the final list (proposal in T2, 16 chips) together with the genre screen's design.
- **Done when:** Eran signs off the card states, the final this-or-that rules and the final genre list, and they are written into P2-U2 / P2-U3 / P2-U4 here.

**P2-U1 · Learner card set** — A3 · U · S–M · deps: none (can start now)
> **In plain words:** Choose the ~120 well-known titles new users rate first, and their order: most-voted first, spread across genres and scales.

- **Output:** `src/app/onboarding/data/learner-cards.json`, an ordered list of **about 120** keys drawn from the 980 game titles. Those already have scales, posters, overviews and trailers. That is the cap of 90 shown (DEC-11) plus room for skipping "never" genres.
- **Selection rules** (a proposal; validate them):
  - Most-voted within each type.
  - At least 4 titles per game genre.
  - For every scale, at least 5 titles at each end (|v| ≥ 0.5).
  - Movies : series ≈ 2 : 1.
  - At most one title per `collection` or `groups` entry.
- **Order:** first the 5 most-voted titles, so people build momentum with titles they've seen. Then round-robin across genres, alternating movie and series.
- **Serving:**
  - Skip titles in the user's "never" genres, using C2's semantics.
  - Stop at 30 seen or 90 shown (DEC-11), then go on to this-or-that.
  - Log the shown and seen counts per user (`play_state.state.onboarding`). The 90 cap is judged on these numbers.
- **Validate:** harness (b) using this order instead of random cards should reach the deck's "after 30 cards" numbers (70 / 56 / 72) minus 3.

**P2-U2 · Genre step** — A3 · U · S · deps: C2, U0 (final genre list; proposal in T2)
> **In plain words:** The first screen: pick the genres you never want to see. It reuses the games' genre screen.

- Reuse the `/play` genre step (`GAME_GENRES`), following mock `1-genres` (no Movies / Series / Both).
- Its "Never" writes `exclusion_rules` through `src/modules/dna/update-from-play.ts`, with game-owned rule ids.

**P2-U3 · Learner cards UI** — A3 (UI), A1 reviews (the ratings path) · U · M · deps: U0, U1
> **In plain words:** The rating cards screen: loved / liked / disliked / haven't seen, until 30 are seen or 90 are shown. The answers appear in My ratings.

- **Mock:** whichever of 2a / 2b / 2c Eran picks.
- **New route `POST /api/onboarding/cards`** (shared `src/app/api`), taking batches of up to 10 answers:
  - **Seen answers** go through **the same write path as a feed rating** (`POST /api/recommendations/feedback`, action `watched` + reaction: factor out its core rather than calling over HTTP).
    - That writes `recommendation_feedback`, which is what My ratings reads (`src/app/api/recommendations/ratings/route.ts`), so the answer appears there (DEC-12).
    - It also merges into `dna.signals` through `src/modules/dna/merge-feedback-signal.ts`.
    - Strand A (creators) updates the same way as for feed ratings.
    - Tag the signal `source: 'onboarding'` (already a valid `SignalSource`) if that is cheap. Otherwise leave the source as the feed path sets it.
  - **"Haven't seen"** → `play_events` with kind `card_unseen` and `item_key` = the title key. It is not a signal; the title stays eligible for the feed.
  - **Bump `taste_version` once per batch**, not once per card.
  - Going back and changing an answer must not write twice.

**P2-U4 · This-or-that** — A3 · U · M · deps: U0
> **In plain words:** About 12 "which would you rather watch?" picks, chosen the same way the season chooses them.

- **Mock:** `4-this-or-that`. 12 picks.
- **Pairs:** use `nextPair` in `src/app/play/lib/brain.ts`. It is the picker that produced the measured picks.
  - Run it on a fresh `PlayState` seeded with the user's genres.
  - The pool is the 980 game titles minus the "never" genres.
  - Don't touch the user's season state.
- **Write** `play_events` with kind `duel` and payload `{a, b, axis, chosen, source: 'onboarding'}` through `/api/play/events`. D4 already reads them.

**P2-U5 · First feed** — A2 + shared · E · M · deps: P1-G
> **In plain words:** Make the first feed appear within about 3 seconds of the last pick, by preparing it while the user is still picking.

- **After the last card:** start a precompute (`generateRecommendations` with `precompute: true`, the existing lock in `precompute.ts`).
- **After the last pick:** bump `taste_version` and generate the final batch. The picks change `w`.
- **Target:** at most 3 s from the last pick to a visible feed (see `docs/speed-plan.md`). Otherwise show the loading state from mock `5-feed`.
- After the cards, a user with 10+ signals runs the normal pipeline. Below 10, `cold-start.ts` runs, as it does today.

**P2-U6 · Routing; the season moves to Games** — shared `src/app` · U · S–M · deps: U2–U4 · flag `ONBOARDING_V2`
> **In plain words:** Send new users to the new onboarding instead of the season; the season moves to the Games tab. Existing users with 10+ ratings skip it.

- **Today:** `src/app/page.tsx` L40 redirects to `/play` until the genres and the season are done or skipped (`PLAY_ONBOARDING_LIVE`).
- **v2:**
  - Redirect to `/onboarding` until `play_state.state.onboarding.done_at` is set. This adds no DNA field (DEC-9).
  - The season is reachable only from Games and the menu.
  - **Existing accounts** (DEC-8): any user with 10 or more signals when the flag goes on is marked done and skips onboarding. Everyone else goes through it.
- **Flag off** = today's behaviour.

**P2-U7 · Account reset tool** — A3 · D · S · deps: none
> **In plain words:** A script that wipes a test account clean, so we can go through the first run again.

- **Script:** `scripts/reset-account.mts --user <uuid>`, dry-run by default.
  - Reset the DNA to blank (`src/modules/dna/blank-dna.ts`), but keep counting `taste_version` upward.
  - Delete `play_state` and `play_events`, `served_titles`, `recommendation_history` and the user's Redis keys.
  - Whether to keep removed titles and the watchlist is a flag.
- **Alternative:** delete the user outright through Supabase admin.
- Never put emails in the repo.

**P2-U8 · Redesign the Taste DNA page** — **Eran** — A3 (page) · U · M · deps: D4 (taste model), C3 (rules)
> **In plain words:** Rebuild the Taste DNA page so it shows only what really drives your recommendations.

- **The full spec is in `docs/BACKLOG.md` → "Taste DNA — task details"**, rewritten for v2 on 2026-11-09. Read it first.
- **In short:**
  - The page shows only what drives recommendations: the header, the 11 scales (the season's `AxisRow` look), genres, how much you follow the crowd, people who pull you in, and rules (Never / Less of).
  - Story traits, Mood & pace, Open Questions and every "Confidence" % are removed.
- **New read-only route** `GET /api/dna/taste` (A3), built from P1-D4's `loadTasteTraining` + `trainTasteModel`, cached per `taste_version`.
- **Before mocks:** settle what the page says about a genre the person watches a lot but rates unevenly (the Alon sci-fi case in the backlog entry).
- **Soft launch:** it ships before the soft launch, since F&F users will open this page.

**P2-G · Gate**
> **In plain words:** Each of us goes through the new first run on a fresh account, on our own phone, and the numbers must pass.

- Each tester goes through the whole flow on a **fresh second account**, on Android Chrome (installed PWA). Their main accounts are kept (DEC-8).
- Harness (b) on their sheets reaches the deck's "+12 this-or-that" numbers (73 / 63 / 75) minus 3.
- R2 has been measured.
- Eran has approved every screen.

### Phase 3 — chat as a consultant

> **In plain words:** bring the chat back as a consultant you can ask things. It never changes your profile or your recommendations, it names only real titles from our catalogue, and it stays inside the free AI budget. What opens it, and whether it may add to your watchlist, is still open (Q5).

- **P3-1 · Gate and entry point** — A1 · S–M. OPEN Q5.
- **P3-2 · Read-only** — A1 · M.
  - Context = `dnaPromptContext` (read-only) plus the user's current feed and watchlist titles.
  - Enforce it with a unit test that fails if anything under `src/app/api/conversation/**` imports `saveDNA`, `applyDirectives`, `mergeFeedback*` or writes to `served_titles` or the recommendation history.
- **P3-3 · Grounding** — A1 · M.
  - Every title the chat names must resolve to a catalogue row (through the search API) before it is shown. Unresolved titles are dropped.
  - Facts come only from database fields (the "no invented facts" rule).
- **P3-4 · Budget** — A1 · S.
  - The chat runs on Groq `openai/gpt-oss-120b`, which has a free budget of about 200k tokens per day per model.
  - Add a per-user daily cap and a global daily guard (a Redis counter), each with a friendly message.
  - Test with mocks. Never test on this model.
- **P3-5 · Delete dead code** — A1 + A3 · S.
  - Delete `analyze-session.ts`, `directive-patterns.ts` and their tests, `update-from-session.ts`, `/api/dna/update-from-session`, and the `temporal_modifiers` readers.
- **P3-G:** the chat answers 10 scripted questions with grounded titles, and the DNA's `taste_version` is unchanged afterwards.

---

## 5. Retests (row 8 of the deck)

> **In plain words:** four things the deck said we hadn't tested yet. We test each one at the point where it becomes testable.

| ID | What | When | Pass |
|---|---|---|---|
| R1 | Jev: keep, fix or off | P1-E7 | The rule in E7 |
| R2 | Step 1 on a real new account: the share of the first 20 feed titles the tester has already seen | After E6, and again at P2-G | Clearly below today's 81–96% (no target was set; report it) |
| R3 | The 11 scales on lesser-known titles: harness (a) on fair My-ratings titles under 1,000 and under 5,000 votes. Also tune the series vote floor and the rating clamp. | After D2 | v2 ≥ v1 per band (Shahar's band is the one with data) |
| R4 | More testers: each F&F user who agrees rates a 100-title sheet → `.eval-data/` | Soft launch | — |

---

## 6. Soft launch (after P3-G)

> **In plain words:** the checklist before friends and family get in: the gates passed, nothing will run out of free budget, we can see how it's doing, and testers can tell us what's wrong.

- [ ] Phases 1–3 gates passed.
- [ ] Sign-up: open, or an invite list (OPEN Q6).
- [ ] Budgets have a daily check:
  - [ ] Mistral (enrichment + scales, in the Dream digest)
  - [ ] Groq (chat)
  - [ ] Typesafe (if Jev is on)
  - [ ] TMDB / OMDB
  - [ ] Supabase free tier
  - [ ] Upstash free tier
- [ ] A **live score**: a weekly script computes, per user, the concordance between `composite_score` and their feed reactions (from `recommendation_history`). It is the deck's metric on real use. Owners: A2 + A3.
- [ ] A way for testers to report problems.
- [ ] Privacy and terms pages are current, and account deletion works.

---

## 7. Phases 4–5 (not planned yet)

**Phase 4** takes its items from `docs/BACKLOG.md` when we get there. Known v2 leftovers:
- The deep 12-dimension survey and the regret signal don't feed v2. Decide whether they should.
- Strands B and C and the embeddings are still written but no longer read for ranking. Deprecate them.

---

## 8. Conventions

- **Flags** live in `src/lib/flags.ts`, a new small file that reads env vars: `FORMULA_V2`, `ONBOARDING_V2`, `CHAT_MODE` (`legacy | off | consultant`) and `JEV_ENABLED`.
  - The default is today's behaviour.
  - Set flags in Vercel and in `.env.local`.
  - Switching a flag on is a gate, not a WP.
- **Migrations:** `0029` and `0030` are reserved (P1-D1, P1-E6).
  - Claim the next free number on your issue before writing it.
  - Run it with `SUPABASE_DB_URL` + `pg` (INTEGRATION.md) and verify it live **before** merging code that needs it.
- **Hot files: one open PR at a time.**
  - `step1-candidate-gen.ts`, `step2-composite-score.ts`, `step3-soft-modifiers.ts`, the generate route: lane E only.
  - `src/app/page.tsx`, `WTWApp.tsx`: lane U only. The one exception is C1's "hide the chat input" change (lane D), which lands first, in week 1.
  - `exclusion-rules.ts`: C2 only.
  - `src/types/dna.ts`: nobody (DEC-9).
- **Models:** model ids live only in `src/lib/ai-models.ts`. Mistral batch calls go through `src/lib/mistral-batch.ts`. Groq reasoning models break `generateObject`.
- **Before every PR:** `nvm use` (Node ≥ 20), then `npm run type-check` and `npm test`.
- **Privacy — the repo is public. Never commit:**
  - `.env.local`
  - `.eval-data/`
  - testers' answers, play events or DNA
  - user ids next to ratings
  - emails
  - `docs/prototypes/rate-run/taste-test/` (gitignored; local reference scripts with data paths)
- **DNA writes:** patch fields, never overwrite the whole schema. Bump `metadata.taste_version` and `last_updated`, and snapshot before bulk scripts (`docs/DNA-CONTRACT.md`).

---

## 9. Open questions — Eran decides

Decided on 2026-11-09 and moved into §1:
- Q1 → DEC-5 (chat hidden)
- Q2 → DEC-6 + P1-C3 (Never / Less of + genre list; More of and people later)
- Q3 → DEC-10 (match %, capped at 97)
- Q4 → DEC-8 (keep accounts)
- Q7 → DEC-11 (cap of 90 cards shown)
- Q8 → DEC-12 (in My ratings)

| # | Question | Status |
|---|---|---|
| Q5 | What gates the chat (after onboarding? only from a title? a daily cap?), and may it add titles to the watchlist? | Open. Watchlist: leaning yes. Needed before phase 3 starts. |
| Q6 | Soft launch sign-up: open, or an invite list? | Open. Needed before the soft launch. |
| Q9 | Does the soft launch need the chat at all, or can it go out after phase 2, with the chat following? | Open. |

---

### Parked topic T1 — "a fingerprint built from big hits" (raised by Alon, 2026-11-09)

**The question:** the cards are big hits that most people loved or liked. Won't every fingerprint come out the same?

**Measured on 2026-11-09** (`docs/plan/EVIDENCE.md` method, local scripts):

1. **No, they differ.** Each person's answers were scored by their own model and by the other two models.

   | Whose answers | Own model | Others' models |
   |---|---|---|
   | Eran | 71 | 59 / 65 |
   | Shahar | 63 | 54 / 60 |
   | Alon | 76 | 70 / 68 |

   - With 30 hit-only cards: own 70 / 62 / 71 vs others 59 / 60 / 64.
   - Any two people's top 20 share 0–4 titles; with 30 hit cards, 1–2.
   - **Why:** the model subtracts each person's own average, and the crowd rating is an input. So "loved a hit" is mostly explained by the hit being a hit; the contrast between loved, liked and disliked is what teaches it.
2. **Weak spots:**
   - **Shahar** (far from the crowd): his own 30-card model barely beats ours (62 vs 60).
   - **Dislikes are thin** (14–23% of seen titles). This-or-that supplies the contrast; that's why it adds the most for Shahar.
   - **Genre fans read low.** Alon is a big sci-fi/fantasy fan; the model reads him as leaning away from sci-fi.
     - Part of the cause: 15 of his 23 sci-fi dislikes are superhero films, which the game genres file under sci-fi.
     - A "superhero" input gains Alon +1.6 and nobody else anything.
     - The rest of the cause: a fan rates the mediocre titles of his genre too, and the model ignores *how much* of his watching a genre is.
3. **Card order (P2-U1):** "most-voted first" beat random order (77 / 61 / 73 vs 73 / 59 / 72) and needed fewer cards shown.
   - "Middling crowd rating first", a cheap stand-in for "titles that split people", was worse (67 / 48 / 71).
   - **So U1 keeps most-voted first.** There is no low-hanging fruit in reshuffling the hits.
   - Real "titles that split people" needs disagreement data from many users. Revisit after the soft launch.

**Candidates to test later** (not in any WP yet):
- a superhero input (catalogue-wide from TMDB keywords);
- a "share of what you watch" signal per genre (from "haven't seen" answers and the volume of ratings);
- divisive cards from F&F data.

**Every user gets the same card list**, minus their "never" genres. The this-or-that pairs adapt to each person.

### Open topic T2 — genres that lump together things people tell apart (Eran, 2026-11-09). **The 11th scale is decided (yes); the genre list is still a proposal.**

**The problem.** The 13 game genres lump together things people tell apart:
- Animation: Pixar vs Winnie the Pooh vs BoJack / South Park / Arcane.
- Sci-fi & fantasy: LOTR vs Captain Marvel vs Star Wars.
- Anime: Ghibli.

A "Never" on a lumped genre hides things people love, and a lumped input teaches the model the wrong lesson: Alon reads "away from sci-fi" because of superheroes. We can't ask people about 293 sub-genres.

**Evidence:**
- **On the scales, Toy Story and South Park are the same title:** funny +1, light −1, easy watch −1, blockbuster −0.77 / −0.63. Today only the "family" tag tells them apart.
- **TMDB already tags what we need** (counts across all 34,973 titles):

  | Tag | Titles |
  |---|---|
  | `superhero` | 662 |
  | `based on comic` | 703 |
  | `adult animation` | 348 |
  | `anime` | 2,253 |
  | `cartoon` | 252 |
  | `dark fantasy` | 158 |
  | Animation + Family | 1,898 |
  | Kids (TV) | 638 |
  | Science Fiction | 3,477 |
  | Fantasy | 3,284 |

**Proposal: two layers.**
1. **Ask little.** The genre screen splits only where a "Never" commonly lands inside a lumped genre:
   - Animation → **Kids' animation** / **Adult animation**;
   - Sci-fi & fantasy → **Sci-fi** / **Fantasy** / **Superheroes**;
   - **Anime** stays its own chip.

   That's about 16 chips instead of 13.
2. **Learn the rest.** The model gets the same finer tags as inputs (from TMDB, free), plus possibly an **11th scale: "made for kids ↔ made for adults"**. It's AI-judged in the same backfill and is the one thing that separates Pixar (all ages) from Pooh (preschool) from BoJack (adults).
   - Because each side gets its own weight, a simple model can learn "adult animation yes, kids' animation no".
   - "Only Pixar" is learned from people (Pixar's directors) through the creators part. Studios as a creator type (Pixar, Ghibli, Marvel Studios, A24) are a further candidate.

**A test before deciding** (cheap, no full run):
- the tags as inputs on the 980 titles;
- the audience scale scored for the 980 only (~98 calls);
- harness scores for the three testers.

The genre-screen split is a product decision; the harness can't measure it.

**Result of the test (2026-11-09).** The kids ↔ adults scale was scored by AI for 973 of the 980 titles (98 calls, ~1 hour at 8 s spacing; a few calls hit Mistral's rate limit). The tags come from TMDB keywords and genres.

| Version of the model | (a) Everything rated, 5-fold: Eran / Shahar / Alon | (b) New user, 30 hit cards: Eran / Shahar / Alon |
|---|---|---|
| Today (24 inputs) | 72.3 / 64.3 / 76.6 | 72.1 / 58.4 / 72.3 |
| + finer tags (superhero, adult / kids animation, sci-fi ≠ fantasy) | 71.9 / 63.3 / **77.9** | 71.5 / 58.0 / **73.4** |
| + kids ↔ adults scale | **74.7** / 64.7 / 76.4 | **73.0** / 58.6 / 71.8 |
| + both | 73.7 / 63.6 / 77.8 | 72.1 / 58.1 / 73.2 |

- **Overall:** small gains, mostly within noise (2–3 points). The scale helps Eran most (+2.4); the tags help Alon (+1.3, L/D +2.2) and cost Eran and Shahar about 0.5–1.
- **The cases Eran named, with both added** (Eran's rank among the 980 titles, today → with both):
  - **Up:** South Park 18 → 1, Rick and Morty 85 → 16, Family Guy 212 → 45, BoJack 214 → 140, Arcane 446 → 372.
  - **Down:** Inside Out 360 → 426, Spirited Away 470 → 578, Frozen 751 → 816.

  The lift comes from the **scale** (Eran's weight on "made for adults" is +0.25), not from the "adult animation" tag (weight 0.00: he has rated no titles with that tag). **The scale generalises from everything you rate; a tag only learns once you rate titles inside it.**
- **Alon:** the "sci-fi" penalty mostly moves off sci-fi (−0.48 → −0.10) onto superheroes (−0.52) and fantasy (−0.37: the Harry Potters, the Twilights, Frozen). On his sheet, the LOTR films are "liked", not "loved".

**Recommendation (Claude):**
1. **DECIDED (Eran, 2026-11-09): add the kids ↔ adults scale as the 11th scale, in the full backfill (P1-D2).** It is one more number in the same AI call, so it costs no extra calls. It is the only change that fixes the animation case for someone who hasn't rated inside the genre, and it costs nobody anything. The feature count becomes 25.
2. **Don't put the tags into the model yet.** They're free and can be added at any time without re-scoring. Re-test them when there are more testers (R4).
3. **Do use the tags for the genre screen and the rules** (a product decision for Eran): Kids' animation / Adult animation / Anime / Sci-fi / Fantasy / Superheroes, about 16 chips. A "Never" there then hides exactly what it names (DEC-6).

**Proposed genre list. PROPOSED, NOT FINAL:** Eran and Claude settle it in the P2-U0 design pass. Until then, `GAME_GENRES` (13) stays as it is in code.

| # | Today (13) | Proposed (16) | Built from (TMDB) | Examples |
|---|---|---|---|---|
| 1–5 | Comedy · Drama · Action · Crime · Thriller & mystery | unchanged | as today | |
| 6 | Sci-fi & fantasy | **Sci-fi** | Science Fiction, or Sci-Fi & Fantasy with sci-fi keywords; **not** `superhero` | Star Wars, Blade Runner, Interstellar |
| 7 | | **Fantasy** | Fantasy, or Sci-Fi & Fantasy with fantasy keywords; **not** `superhero` | LOTR, Harry Potter |
| 8 | | **Superheroes** | keyword `superhero` | Captain Marvel, The Avengers |
| 9–10 | Horror · Romance | unchanged | as today | |
| 11 | Animation | **Adult animation** | keyword `adult animation` | BoJack, South Park, Family Guy, Arcane |
| 12 | | **Kids' animation** | Animation + (Family or Kids), not adult animation | Pixar, Winnie the Pooh, Frozen |
| 13 | Family & kids | Family & kids, **live-action only** | Family / Kids, not Animation | |
| 14–16 | Anime · Documentary · War & history | unchanged | as today (Ghibli = Anime) | |

- **Superhero titles sit only under Superheroes**, never under Sci-fi or Fantasy, so "Never superheroes" and "Never sci-fi" stay independent. Other genres still apply: The Dark Knight is Crime + Action + Superheroes.
- **There's no single "Animation" chip.** Hating all animation = "Never" on both animation chips.
- **The chips are guardrails ("never show me"), not taste.** Pixar vs Pooh inside Kids' animation is the taste model's job: the kids ↔ adults scale plus creators.
- **When it's final, it changes:**
  - `GAME_GENRES` in `src/app/play/lib/genres.ts`, plus its TMDB mapping (`candidateGenres`);
  - the genre step (P2-U2);
  - the rules dropdown (P1-C3: build it from `GAME_GENRES`, so it follows automatically);
  - C2's exact-genre matching;
  - the season's saved states (`withAllGenres` gives new chips a neutral value, as it did for "Family & kids" on 2026-11-06).
4. **For P1-D2's quota probe:** at 8 s spacing, 98 calls took about an hour and still hit the rate limit a few times. The full ~3,500 calls need about 36 hours, so plan several nights or a paid tier.

## 10. Code map

| Thing | Where |
|---|---|
| Pipeline entry | `src/modules/engine/pipeline/generate.ts` (cold start → step 1 → 2 → 3 → 3b compose → kids → 4 Jev → 5 stretch → 6/7 why → 8 cache) |
| Cold start | `pipeline/cold-start.ts`, `READY_SIGNALS = 10` (or a finished season) |
| Step 1 pools | `pipeline/step1-candidate-gen.ts`: votes 150, narrative 150 (min votes 1,000), SEEN 150, 6 h cooldown; RPCs in migrations 0019 / 0020 / 0026 |
| Step 2 | `pipeline/step2-composite-score.ts` `WEIGHTS` {crew .32, narrative .25, visceral .15, content .15, external .12, recency .01} |
| Scorers | `src/modules/engine/scoring/*` |
| Jev | `pipeline/step4-llm-rerank.ts` (`JEV_DISLIKE_THRESHOLD` 0.8), `src/lib/jev.ts` (`TYPESAFE_API_KEY`) |
| Why | `pipeline/step6-reason-payload.ts`, `step7-card-reason.ts`, `src/modules/engine/why/*` |
| Display % | `src/app/api/recommendations/generate/route.ts` `MATCH_DISPLAY_CEILING`, `src/app/components/RecCard.tsx` |
| Rules | `src/lib/exclusion-rules.ts`, `src/modules/dna/lib/apply-directives.ts`, `src/app/api/dna/rules/route.ts` |
| Chat → DNA (to cut) | `src/app/api/conversation/message/route.ts`, `src/app/api/session/end/route.ts`, `src/modules/session/analyze-session.ts`, `directive-patterns.ts`, `src/modules/dna/update-from-session.ts` |
| Ratings → DNA | `src/modules/dna/merge-feedback-signal.ts`, `src/modules/session/feedback-signals.ts`, `src/app/api/recommendations/feedback/route.ts` |
| Season / games | `src/app/play/**`; scales `lib/scales.ts`; pair picker `lib/brain.ts` `nextPair`; data `data/titles.json` (980), `data/ai-scores.json`; builder `scripts/build-play-titles.mts`; play → DNA `src/modules/dna/update-from-play.ts` |
| Onboarding today | `src/app/page.tsx` L40 → `/play` (`src/lib/play-rollout.ts` `PLAY_ONBOARDING_LIVE`) |
| Play storage | migration `0024_play_progress.sql`: `play_state`, `play_events(kind, item_key, payload)` |
| Enrichment | `src/modules/engine/enrichment/nightly-enrichment.ts`, `scripts/grow-catalog.mts`, `src/lib/mistral-batch.ts` |
| Tests | `tests/unit/*.test.ts` (vitest), `tests/component`, `tests/e2e` |
