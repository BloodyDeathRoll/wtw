# Taste Games — handoff (updated 2026-10-18)

> Read this first in the next session, then `CLAUDE.md` and `docs/INTEGRATION.md`
> (its 2026-10-14 → 2026-10-18 entries are the detailed build log).

## Who you're working with

Eran is a PM with a UX specialty, **not a developer**. Plain product language; explain anything technical in one plain sentence; lead with what the user sees. Eran owns A3 (DNA Writer); A1 (Session Brain) and A2 (Engine) are the developer partners.

**How Eran works with you:**
- New designs → **JPEG mock-ups first** (2–3 options, real content, phone size), Eran picks, then build. Pipeline: HTML in `docs/prototypes/block-done/` → headless Chrome → `sips` → JPEG (see the existing `*.html` there).
- Eran plays the build at `localhost:3000/play?demo=1` and sends screenshots + numbered feedback. Answer each point, fix the clear ones, propose options for structural ones.
- Never say "done" without clicking it through yourself (browser pane, mobile size; screenshots taken mid-fade look dim — retake).
- **Ask before every commit and push.** Eran said the work is "close but not push-and-commit material yet".

## Where the work is

- Branch **`feat/taste-games`**, local only. One local save-point commit, "WIP: taste games /play (local save point, not for push)" — **not pushed**. Rewrite/squash freely before a real PR.
- Hidden route **`/play`** (+ `/api/play/state`, `/api/play/events`). Nothing links to it; it does **not** write the live DNA (that's Slice 2).
- Demo without sign-in (dev only): **`/play?demo=1`** — progress in the browser (`localStorage` key `wtw-play:dev-demo`; clear it to start fresh). Note: the app's built-in browser lost its storage overnight on 2026-10-18/19, taking Eran's finished-season save with it — browser saves are not durable.
- Dev server: `npm run dev` (the app's browser pane uses `.claude/launch.json` → `wtw-dev`, port 3000).

## What the user experiences now (all built and clicked through)

1. **Intro → genre setup** (Love / Like / Never per genre; Movies/Series/Both). "Never" blocks a title everywhere, using a wider "might be" list (`never`) per title.
2. **Season 1 — 15 steps**, path map shown after setup, "N of 15 done" on every training screen (tap → path map):
   genres ✓ → This or that → Knockout → This or that → **Blind Taste Test** → Lightning → This or that → **The Other Side of the Story** → Deep dive → This or that → **Higher or Lower** → Directors → This or that → **Final round** (5 picks, the brain's call sealed before each) → **Finale** (Wrapped-style viewer profile, then picks).
3. **Every step** opens with an intro page (except via the closing card) and closes on the **approved closing template**: block label in its colour · "STEP N DONE" · stat line · fan of the posters picked (2 fans above 8; Knockout = all 8 contenders, champion centred) · "What I learned" with `*highlighted*` words · (game steps: "Full game in Games" strip) · "Up next" card.
4. **Leaving and coming back** resumes the exact screen (pair, bracket, timer).
5. **After the season**: Tonight's picks (live-app card look: trailer, where to watch, "Why this pick?" with reasons for/against, ❤️/👍/👎/✕ reactions — saved to the game log only, watchlist "soon"), The Bet + Mind Reader unlock in Games, the finale card tops My taste, extra "sharpen" steps continue the old rotation.
6. **Games tab**: the 3 season games always open (5 levels each), The Bet / Mind Reader after the season, 4 "Soon".

## Rules Eran set (do not re-litigate)

- **Facts must be real.** Games use only TMDB data (plots, character names, ratings, years). No AI-written trivia; a "Did you know?" needs a sourced dataset first.
- **No fake guessing.** Anything that claims to know the player (viewer name, "% match", trusted creators, "right in your zone", hunches) waits until the brain *predicts their picks* clearly better than a coin flip (`readsYou` / `canHunch`, Wilson lower bound). Random tapping must never look like taste.
- **Never repeat** a served item in a game (`S.served`), even across Games ↔ season step.
- **Season games are always open**; no "unlocks after X" on their closing screens.
- **No teaser pick** mid-season. No chapters, levels or % meters on training screens.
- **"Seen with the kids"** counts as seen, not personal taste.
- Variety: max 2 films per series, no two of the same series/superhero group in one pair, superhero spaced out, a group turned down twice disappears.

## Code map (`src/app/play/`)

| File | What |
|---|---|
| `lib/brain.ts` | Player state (`PlayState`, **v: 3**), beliefs, pair picker + variety, predictions/`readsYou`, hunches, plot twist, picks + `whyPick`, The Bet, pick reactions |
| `lib/blocks.ts` | `SEASON`, block/step kinds (`BLOCKS` texts + accents), Knockout, lessons |
| `lib/games.ts` | Blind/Other/Hilo content: `redact`, `clues`, decks, `options`, levels, served tracking |
| `lib/genres.ts`, `lib/scales.ts`, `lib/select.ts` | genre mapping, scales + `GameTitle`, balanced title selection |
| `components/PlayApp.tsx` | Controller: every action, screen flow, saving. State mutates only in handlers (StrictMode) |
| `components/Screens.tsx` | Main screens (duel, intro, closing, picks pages, My taste, menu) |
| `components/season.tsx` | Season bar, path map, final round, finale |
| `components/gameplay.tsx`, `games.tsx` | Season game screens; arcade lobby + The Bet / Mind Reader |
| `components/Picks.tsx` | Picks in the live feed's card style (imports its CSS module read-only) |
| `play.css` | All styles, scoped under `.wtw-play` (ported prototype + additions). Beware generic class names (`done`, `game` already exist) |
| `data/titles.json` | 500 titles. Rebuild: `npm run build-play-titles` (pinned set, 0 AI calls; `--reselect` re-picks and re-scores) |
| `data/ai-scores.json`, `data/title-fixes.json` | cached AI scales; hand corrections (genres, scales, `never`, `redact`) |

Tests: `tests/unit/play-brain.test.ts`, `tests/unit/play-titles.test.ts` (41). Full suite 522 passing; type-check + lint clean at the save point.

## Next move: the PR (agreed with Eran 2026-10-19, not started)

1. Squash the local save points + the uncommitted watchlist work into one commit.
2. Re-run type-check, lint, full tests.
3. CLAUDE.md line → "No forms, no surveys — onboarding and sessions are conversational or played (the taste games); never a questionnaire." (proposed; Eran to OK the wording).
4. Draft a heads-up to Shahar (A1): `/play` in shared `src/app/`; reuses `RecommendationsView.module.css` read-only; `src/lib/watchlist.ts` gained optional `from`; `RecommendationsView` hides "% match" when there's no score (Eran's decision).
5. PR description; push `feat/taste-games` and open the PR on github.com (`gh` isn't installed). **Ask Eran before pushing.**
Explained to Eran in plain words: merging makes /play a hidden page of the real app; it doesn't connect it to the brain, the 30k catalogue or the DNA (next phase). The watchlist IS connected (device-only, like the live list).

## Still open

1. **Eran's polish list** before it's commit-worthy. Round 3 (2026-10-18 evening) — done: final round = 10 confident pairs (`showdownPair`), blackout of ordinary words. Done: Blind plots retold (`data/plot-rewrites.json`, 494, written by Claude after Eran compared it with the free model; checker `scripts/check-play-plots.mts` — all 494 checked and triaged, ~27 real fixes). Done 2026-10-19: Other Side rebuilt as side characters telling the story (`data/other-clues.json`, 123 titles, "Haven't seen it" exit). Done 2026-10-19: the reveal in three tones (`lib/reveal.ts`), "My picks" rename, demo shortcut `/play?demo=1&jump=N`. Done 2026-10-19: watchlist connected (ribbon everywhere, My watchlist screen, saves count). Live watchlist card hides "% match" without a score (A1's file, flagged in the PR). Open: moving the watchlist to the database, what comes after the season (step 16 is a letdown: Season 2 vs a lighter daily set — Eran to say).
2. **Saved progress tables**: `supabase/migrations/0024_play_progress.sql` written, **not run**. Until then `/api/play/*` answer 503 and progress stays in the browser. Someone with Supabase access runs it (ask Eran first).
3. **Preview link**: Vercel git deploys are off by design; Shahar was asked (WhatsApp, 2026-10-14) for a branch deploy hook, Preview env keys, and the preview URL in Supabase auth redirects. Eran's `.env.local` is from May; its Upstash URL is dead (only matters for the live app locally).
4. Before a real PR: update CLAUDE.md's "No forms, no surveys — onboarding and sessions are conversational" line (draft wording for Eran), tell A1 about `src/app/play/`, squash the WIP commit.
5. 8 titles from the title check were never verified (Eran hadn't seen them) — low priority.
6. `gh` CLI not installed on this Mac; PRs via github.com.

## Starting prompt for the next session

> Read `docs/taste-games-handoff.md`, then `CLAUDE.md` and the latest entries in `docs/INTEGRATION.md`. We're on branch `feat/taste-games` (local only, one WIP save-point commit, not pushed). Start the dev server, open `/play?demo=1` yourself and play a few steps so you know the current state. Then tell me you're ready — I'll send my next round of feedback on the season. Don't commit or push without asking me.
