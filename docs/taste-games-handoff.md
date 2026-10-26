# Taste Games — handoff (updated 2026-10-25)

> Read this first in a games session, then `CLAUDE.md` and the latest entries in
> `docs/INTEGRATION.md` (2026-10-14 → 2026-10-25 are the build log).
> **One session per game.** The opening prompt for a new game session is at the bottom.

## Who you're working with

Eran is a PM with a UX specialty, **not a developer**. Plain product language; explain anything technical in one plain sentence; lead with what the player sees. Eran owns A3 (DNA Writer) and, since 2026-10-24, **the games** (`src/app/play/`); Shahar (A1, Session Brain) and Alon (A2, Engine) are the developer partners.

**How Eran works with you:**
- **"Games" means the Games tab** (`components/games.tsx`). This or that, Knockout and Lightning are season training steps, not games.
- **One game at a time:** idea → feedback on the idea → mock-ups → Eran picks → playable prototype → Eran plays → fixes → build → Eran plays → PR. Finish one before the next.
- **Mock-ups first, then a playable prototype.** Still mock-ups: HTML in `docs/prototypes/<topic>/` → headless Chrome → `sips` → JPEG, 2–3 options, real content, phone size. For anything with motion or feel, a **playable prototype as a private Artifact page** he can open on his phone (`docs/prototypes/six-degrees/play.html` is the model: real data, images embedded as data URIs, every path playable, animations, a shortcut to the end screen when comparing options). He iterates on it many times; expect 5–10 rounds.
- Eran plays and sends screenshots + numbered feedback. Answer each point; fix the clear ones; for structural ones, give a recommendation, not a menu.
- **Never say "done" without clicking it through yourself** (browser pane, mobile preset, `localhost:3000/play?demo=1&jump=16&tab=games` = a finished-season player in the Games tab). Screenshots taken mid-fade look dim; retake.
- **Ask before every commit, push and merge. Merges stay manual** (Eran, 2026-10-25), even with Auto-fix on. Merging to `main` deploys to production for every player.
- `gh` is at `~/.local/bin/gh` (signed in as eran-manor). Eran's account can push and merge but **is not admin** of the repo: secrets, branch protection and the review bot's token (`CLAUDE_CODE_OAUTH_TOKEN`) are Shahar's (owner `BloodyDeathRoll`).
- When he disputes something ("did we agree?"), check what was actually said and say so plainly. Don't claim agreement that wasn't given.

## Where things stand (2026-10-25)

- The games are **the app's onboarding, live for every user** (#130). `/` redirects to `/play` until the season is finished or skipped.
- **#136** Blind Taste Test rebuilt as the "book cover" game. **#145** Six Degrees, a new game, plus one button style for all games. **#146** title set 500 → 980, Blind 274 → 535 stories, Six Degrees 12 → 38 chains. All merged and live.
- Progress saves to `play_state`; every answer goes to `play_events`. Only a few people play: judge games by playing, not stats.

## What a player experiences now

1. A voice intro (new users) → **genre setup** (Love / Like / Never; Movies / Series / Both).
2. **Season 1, 15 steps**: This or that → Knockout → This or that → **Blind Taste Test** (level 1) → Lightning → This or that → **The Other Side of the Story** → Deep dive → This or that → **Higher or Lower** → Directors → This or that → **Final round** (10 sealed calls) → **Reveal** in three tones (confetti once at 7/10+).
3. **Skip** after the genres; skipped players get a "Finish calibration" card every 15 recommendations. Finishing opens the app's real recommendations.
4. **Games tab** (`/play?tab=games`):
   - **Blind Taste Test** — the story told without what you'd judge on sight ("I'd watch it" / Pass), then the cover is revealed (poster, trailer, where to watch, the cover line) → Next story / Seen it / Changed my mind. Five levels by kind of cover: Not who you think (animated, animals) · Longer than you think (series) · Older than it sounds (before 2000) · Not in English · Never heard of it (mostly true crime). `data/blind-covers.json`.
   - **The Other Side of the Story** — side characters tell the story, five clues, type to guess.
   - **Higher or Lower** — TMDB rating (or year) streaks.
   - **Six Degrees** — order six actors from a start to an end; each was in a film with the next. Characters with ↑ (film with the actor above) / ↓ (below) / ↕ (same role in both), Check (4 tries, right spots turn green, Wordle-style flip), 💡 Hint ×4 (three films side by side, then one actor placed), points out of 5, timeline ending with the five films and watchlist ribbons. Keyboard ↑↓ moves rows too. No levels yet. `data/six-chains.json`.
   - **The Bet**, **Mind Reader** — after the season.
   - **Soon:** Choose the Ending, Movie Night Planner, Upgrade, Recast.
5. **Watchlist ribbon** on every poster saves into the app's one synced watchlist; a save counts as a taste signal.

## The games teach the real app (Slice 2 — landed 2026-10-21)

What "Behind the curtain" shows is what the live taste DNA registers: the scale beliefs, the genre chips (and "Never"), the creators they trust. It happens on the server after a save, at milestones, and each sync replaces what the previous one wrote. Details: `docs/INTEGRATION.md` (2026-10-21) and `docs/DNA-CONTRACT.md` ("The taste games as a writer"). Game reactions on single titles (`pickReactions`, Blind's "Seen it") are not written as title signals, by design.

## Rules Eran set (do not re-litigate)

- **Facts must be real.** TMDB data or film details checked against it; mark film-detail facts (`src: "film"`) for spot-checks. No AI-invented trivia.
- **No fake guessing.** Nothing claims to know the player until the brain predicts their picks clearly better than a coin flip (`readsYou` / `canHunch`). No score → no score, never "0".
- **Never repeat** a served item in a game (`S.served`), even across Games ↔ season step.
- **Memory, not guessing** (Six Degrees): hints jog memory (films, characters); a game must not be solvable by brute force alone.
- **Variety beats volume.** In Six Degrees a pair-and-film link appears once in the whole set, a film in ≤2 chains, a face in ≤3; Eran noticed repeats after six chains. Two+ women per chain; a hand list of faces too few would know.
- **Season games are always open.** No teaser picks, no meters or % on training screens. Confetti only when earned, dropped once.
- Eran dislikes jargon, meters that mean nothing, endless aimless loops, fake claims, and anything that looks "AI-generated".

## UI conventions for every game (Eran, 2026-10-24)

- **One button look:** every button on a game screen is a 56px pill with 18px text — orange gradient for the main action (`.cta` / `.opt.primary`), the same dark pill for the rest (`.opt`, `.ghost`). One rule under `.screen.game-screen` in `play.css` enforces it; render new games inside `GameScreen` and never add per-game button sizes.
- **End screens have one button** (Play again / Next level / Next chain). Never "Back to games": the ✕ at the top does that.
- **Pinned bottom buttons get no backdrop** (the screen has a gradient; a dark fade reads as a black box).
- `.game` is an old card class — don't reuse it. Highlights in summary lines: `*word*` via `Marked` (`ui.tsx`).
- A game without levels is fine: the lobby shows "N played · best X of 5", the top bar "CHAIN N".
- Motion: gentle and purposeful (glide in/out, sharpen from blur, staggered rise, Wordle flip); always still under reduced motion.

## Code map (`src/app/play/`)

| File | What |
|---|---|
| `lib/brain.ts` | Player state (`PlayState` v3), beliefs, pair picker + variety, predictions / `readsYou`, final round, The Bet, `reactToPick` |
| `lib/blocks.ts` | `SEASON` order, step texts and colours, Knockout |
| `lib/games.ts` | Blind (cover levels, `blindDeck`, `blindChips`) / Other Side / Higher or Lower: content, levels, decks, served tracking |
| `lib/six.ts` | Six Degrees: deal (never twice, spaced faces/films), start board, right spots, hint order, place hint, points, ↑↓ role tags |
| `lib/reveal.ts`, `lib/watchlist.ts`, `lib/demo.ts` | Season reveal; watchlist bridge (`SaveSource` per game); dev demo player |
| `lib/server.ts`, `lib/events.ts`, `components/persist.ts` | Saving to `play_state` / `play_events` |
| `components/PlayApp.tsx` | Controller: every action, screen flow, saving, game runs (`sixDealRun`, `blindAdvance`…) |
| `components/games.tsx` | Games tab (`GAMES` list), intro / over screens, `GameScreen` |
| `components/gameplay.tsx`, `six.tsx` | Play screens (Blind, Other Side, Higher or Lower; Six Degrees) |
| `components/Screens.tsx`, `season.tsx`, `watchlist.tsx`, `ui.tsx` | Season screens, watchlist, shared bits (`Poster`, `SaveRibbon`, `Marked`) |
| `play.css` | All styles, scoped under `.wtw-play` |
| `data/titles.json`, `ai-scores.json` | 980 pinned titles and their model scores |
| `data/blind-covers.json`, `six-chains.json`, `other-clues.json`, `plot-rewrites.json` | Game content |

**Scripts:**
- `npm run build-play-titles` — title set (read-only on Supabase; Mistral for scales). `-- --grow N` adds N gap-weighted titles and keeps the rest; `--select-only` is a dry run.
- `npm run build-six-chains` — Six Degrees chains from TMDB casts (cached in the OS temp folder). `KEEP`, `MAX_PER_*` and the `SKIP` face list are at the top. Searching inside a theme (restrict links to titles of a decade or genre) found 21 classics / 17 drama / 13 pre-2000 / 13 crime / 7 comedy chains on the 980 — themed levels are possible but need a face pass first.
- `scripts/check-play-plots.mts` — AI fact check of `plot-rewrites.json` (Groq free tier). It does not cover `blind-covers.json` stories yet.

**Tests:** `tests/unit/play-brain`, `play-titles` (data checks incl. Blind covers), `play-six` (logic + chain data), `play-watchlist`; `tests/component/SixPlay.test.tsx`. Dev demo: `localhost:3000/play?demo=1` (`&jump=16` finished season, `&jump=14` final round, `&new=1` brand-new user). First load after a restart compiles for ~30 s.

**Working tips:** large data files go through Python one-off scripts in the session scratchpad; TMDB key in `.env.local` (`TMDB_API_KEY`) — never print it. If another branch needs a fix while uncommitted work sits in the checkout, use a `git worktree` in the scratchpad (symlink `node_modules` and `.env.local`), then remove it.

## Open items

- **Six Degrees themed levels** — the data exists (see above); needs Eran's choice of themes and a face pass.
- **Blind stories' fact check** — extend `check-play-plots.mts` to `blind-covers.json`.
- **A stray change** in `PlayApp.tsx` (unknown game id → default accent) sat uncommitted in Eran's checkout on 2026-10-25, author unknown; ask Shahar.
- **Review bot** (`claude-review`): it failed instantly on 2026-10-24 (likely an expired token) and worked again once Shahar re-ran it.

## Ideas on the shelf (from Eran, not built)

- The four "Soon" games: Choose the Ending, Movie Night Planner, Upgrade (pick one of four → three you'd like more), Recast.
- "WTW pre-selects which of two posters you'd pick; you say right or wrong."
- Overrated / Underrated (was in the prototype).
- What comes after Season 1: Season 2 vs a lighter daily set (Eran to decide).
- Share on the reveal; search to add to the watchlist.
- Data first: a "Did you know?" needs a sourced dataset.

## How to judge a game

**Fun** (Eran wants to keep playing — he'll tell you when it's too hard), **a real taste signal** where possible (fun-only games are fine too, Eran 2026-10-23), and **honesty** (real facts, no fake knowing, nothing repeated).

## Opening prompt for a new game session

> Read `docs/taste-games-handoff.md`, then `CLAUDE.md` and the latest entries in `docs/INTEGRATION.md`. We build the games one at a time, one session per game. Pull `main`, start the dev server (preview_start "wtw-dev") and open `/play?demo=1&jump=16&tab=games` at phone size so you know the Games tab as it is now. Then tell me you're ready and I'll tell you the game. Feedback on the idea first, then mock-ups, then a playable prototype; follow the UI conventions in the handoff; don't commit, push or merge without asking me.
