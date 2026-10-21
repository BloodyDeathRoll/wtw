# Taste Games — handoff (updated 2026-10-21)

> Read this first in a games session, then `CLAUDE.md` and the latest entries in
> `docs/INTEGRATION.md` (2026-10-14 → 2026-10-21 are the build log).
> The opening prompt for the next session is at the bottom.

## Who you're working with

Eran is a PM with a UX specialty, **not a developer**. Plain product language; explain anything technical in one plain sentence; lead with what the player sees. Eran owns A3 (DNA Writer); Shahar (A1, Session Brain) and Alon (A2, Engine) are the developer partners.

**How Eran works with you:**
- New designs → **mock-ups first** (2–3 options, real content, phone size), Eran picks, then build. Pipeline: HTML in `docs/prototypes/<topic>/` → headless Chrome → `sips` → JPEG (see `docs/prototypes/reveal/` and `watchlist/`).
- Eran plays and sends screenshots + numbered feedback. Answer each point, fix the clear ones, propose options for structural ones.
- Never say "done" without clicking it through yourself (browser pane, phone size; screenshots taken mid-fade look dim — retake).
- **Ask before every commit, push and merge.** Since 2026-10-21 GitHub's `gh` tool is installed (`~/.local/bin/gh`, signed in as eran-manor), so Claude pushes, opens the PR, watches the checks and merges, each only after Eran's OK. No more GitHub Desktop round trips.

## Where things stand (2026-10-21)

- **#129 merged** (2026-10-19): `/play` — the season, the three season games, the reveal, My picks, the watchlist ribbon.
- **#130 merged by Shahar** (2026-10-21): the games are now **the app's onboarding, live for every user** (`PLAY_ONBOARDING_LIVE = true` in `src/lib/play-rollout.ts`). `/` redirects to `/play` until the player finishes the season or taps Skip. Home lost the input bar (chat is the top-left icon) and has Picks · Watchlist · Games buttons. `/play` sits in the app shell, follows Shahar's Figma "games" frame (orange primary buttons), and has no step numbers or path map. Brand-new players hear a voice intro that leads into the games.
- **Progress tables (migration 0024) run live on 2026-10-19.** Signed-in progress saves to `play_state`, and every answer goes to `play_events`. Only a couple of people play so far, so there's no meaningful data yet: judge games by playing them, not by stats.
- **Merging to `main` deploys to production automatically** (GITGUIDE). Every games change reaches real users on merge, so click it through before the PR.

## What a player experiences now

1. A voice intro (new users) → **genre setup** (Love / Like / Never; Movies / Series / Both).
2. **Season 1, 15 steps** (fill-only bar, no numbers): This or that → Knockout → This or that → **Blind Taste Test** → Lightning → This or that → **The Other Side of the Story** → Deep dive → This or that → **Higher or Lower** → Directors → This or that → **Final round** (10 picks, the brain seals its call before each) → **Reveal** in three tones by that score (confetti once at 7/10+, "You stumped me" at 0–3).
3. **Skip** is available after the genres (confirm sheet) and lands on recommendations. Skipped players see a "Finish calibration" card every 15 recommendations.
4. **Finishing the season opens the app's real recommendations.** The games' own picks screen (`Picks.tsx`) can no longer be reached.
5. **Blind Taste Test is the "book cover" game** (2026-10-21): the story told without what you'd judge on sight, then the reveal and "still in?". Five levels by kind of cover; content in `data/blind-covers.json`.
6. **Games tab** (home's Games button, menu "Play" → `/play?tab=games`): Blind Taste Test, The Other Side, Higher or Lower (always open, 5 levels each); The Bet and Mind Reader (after the season); "Soon": Choose the Ending, Movie Night Planner, Upgrade, Recast. **Restart calibration** is here too.
7. **Watchlist ribbon** on every poster saves into the app's one synced watchlist; a save counts as a taste signal.

## The biggest gap: the games don't teach the real app yet

The season's answers stay in the games' own brain. They **do not write the live taste DNA** ("Slice 2"), so the recommendations a player lands on after 15 steps don't reflect anything they played. Every new user now goes through the games, so this matters more than any polish. It's DNA-writer work, which is **Eran's lane (A3)**, with Alon (engine) for how the picks use it. Rules for any DNA write: `docs/DNA-CONTRACT.md`.

## Rules Eran set (do not re-litigate)

- **Facts must be real.** Games use only TMDB data (plots, character names, ratings, years) or film details checked against it. No AI-invented trivia; a "Did you know?" needs a sourced dataset first. Rewritten text gets the automatic name/fact check (`scripts/check-play-plots.mts`).
- **No fake guessing.** Anything that claims to know the player (viewer name, "% match", hunches) waits until the brain *predicts their picks* clearly better than a coin flip (`readsYou` / `canHunch`, Wilson lower bound). Random tapping must never look like taste. No score → show no score, never "0".
- **Never repeat** a served item in a game (`S.served`), even across Games ↔ season step.
- **Season games are always open.** No teaser pick mid-season. No chapters, levels or % meters on training screens.
- **"Seen with the kids"** counts as seen, not personal taste.
- Variety: max 2 films per series, no two of the same series/superhero group in one pair, superhero spaced out, a group turned down twice disappears.
- Confetti only when it's earned (7/10+), and it drops once — never a still image.
- Eran dislikes jargon, meters that mean nothing, endless aimless loops and fake claims.

## Code map (`src/app/play/`)

| File | What |
|---|---|
| `lib/brain.ts` | Player state (`PlayState` v3), beliefs, pair picker + variety + `familiar()`, predictions / `readsYou`, final-round `showdownPair`, The Bet |
| `lib/blocks.ts` | `SEASON` order, step texts and colours, Knockout, `SHOWDOWN_PICKS = 10` |
| `lib/games.ts` | Blind / Other Side / Higher or Lower content, levels, decks, options, served tracking |
| `lib/reveal.ts` | The reveal's three tones |
| `lib/watchlist.ts` | Bridge to the app's watchlist (`src/lib/watchlist.ts`, untouched) |
| `lib/demo.ts` | Dev shortcut: a simulated player at step N |
| `lib/server.ts`, `lib/events.ts`, `components/persist.ts` | Saving to `play_state` / `play_events` |
| `components/PlayApp.tsx` | Controller: every action, screen flow, saving |
| `components/Screens.tsx`, `season.tsx`, `gameplay.tsx`, `games.tsx`, `watchlist.tsx`, `ui.tsx` | Screens |
| `play.css` | All styles, scoped under `.wtw-play` |
| `data/titles.json` | The 500 pinned titles (`npm run build-play-titles`) |
| `data/plot-rewrites.json`, `data/other-clues.json` | 494 retold plots; 123 titles × 5 side-character clues |

Tests: `tests/unit/play-brain.test.ts`, `play-titles.test.ts`, `play-watchlist.test.ts`. Dev demo without sign-in: `npm run dev` → `localhost:3000/play?demo=1` (`&jump=14` = final round, `&new=1` = brand-new user with the voice intro). Dev only.

**Shared folder:** `src/app/` is "one person at a time". Shahar has been changing `/play` actively (#130), so say so in the group chat before a games branch, and pull `main` first.

## Ideas on the shelf (from Eran, not built)

- The four "Soon" games: Choose the Ending, Movie Night Planner, Upgrade (pick one of four → three you'd like more), Recast.
- "WTW pre-selects which of two posters you'd pick; you say right or wrong."
- Overrated / Underrated (was in the prototype).
- What comes after Season 1: Season 2 vs a lighter daily set (Eran to decide).
- Share on the reveal; search to add to the watchlist.
- Spark-style swipe rows for genres.
- Data first: a "Did you know?" needs a sourced dataset.

## How we work on the games (Eran, 2026-10-21)

- **One game at a time:** idea → mock-ups → Eran picks → build → Eran plays → fix → PR. Finish one before starting the next.
- **No player stats for now.** Only a couple of people play, so don't pull or analyse `play_events`; Eran's play-throughs are the test.
- What makes a game good: **fun** (Eran wants to keep playing), **a real taste signal** (the brain learns something it couldn't from a plain This or that; simulate when in doubt, as for the final round), and **honesty** (real facts, no fake knowing, nothing repeated).

## Opening prompt for the next session (games phase)

> Read `docs/taste-games-handoff.md`, then `CLAUDE.md` and the latest entries in `docs/INTEGRATION.md`. The taste games are live as WTW's onboarding. From now on we build the games, one at a time. Pull `main`, start the dev server, and play `/play?demo=1` yourself so you know how it looks after Shahar's #130. Then tell me you're ready, and I'll tell you which game we're working on. Mock-ups before any build; don't commit or push without asking me.
