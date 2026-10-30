# Taste Games — handoff (updated 2026-10-30)

> Read this first in a games session, then `CLAUDE.md` and the latest entries in
> `docs/INTEGRATION.md` (2026-10-14 → 2026-10-27 are the build log).
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

## Where things stand (2026-10-27)

- The games are **the app's onboarding, live for every user** (#130). `/` redirects to `/play` until the season is finished or skipped.
- **#136** Blind Taste Test rebuilt as the "book cover" game. **#145** Six Degrees, a new game, plus one button style for all games. **#146** title set 500 → 980, Blind 274 → 535 stories, Six Degrees 12 → 38 chains. **#149** The Other Side's reveal rebuilt like the feed card, and one "Seen it" chip across the app. **#150** finishing a level always unlocks the next. All merged and live. **Cast Call** (a new game, this branch `feat/cast-call`) built on the live catalogue; see its section below.
- Progress saves to `play_state`; every answer goes to `play_events`. Only a few people play: judge games by playing, not stats.

## What a player experiences now

1. A voice intro (new users) → **genre setup** (Love / Like / Never; Movies / Series / Both).
2. **Season 1, 15 steps**: This or that → Knockout → This or that → **Blind Taste Test** (level 1) → Lightning → This or that → **The Other Side of the Story** → Deep dive → This or that → **Higher or Lower** → Directors → This or that → **Final round** (10 sealed calls) → **Reveal** in three tones (confetti once at 7/10+).
3. **Skip** after the genres; skipped players get a "Finish calibration" card every 15 recommendations. Finishing opens the app's real recommendations.
4. **Games tab** (`/play?tab=games`):
   - **Blind Taste Test** — the story told without what you'd judge on sight ("I'd watch it" / Pass), then the cover is revealed (poster, trailer, where to watch, the cover line) → Next story / Seen it / Changed my mind. Five levels by kind of cover: Not who you think (animated, animals) · Longer than you think (series) · Older than it sounds (before 2000) · Not in English · Never heard of it (mostly true crime). `data/blind-covers.json`.
   - **The Other Side of the Story** — side characters tell the story, five clues (5 → 1 points), type to guess; four options from clue 4; "Next clue", then "I give up" on the last. The reveal: points tag, poster with ribbon, the title only (26px, 22px when long), "Seen it? Tell me how it was" + Loved / Liked / Disliked (rates the title, moves on), orange "Next story". Five levels: 3 stories · 4 stories · Series edition · Deep cuts · 5 stories.
   - **Higher or Lower** — TMDB rating (or year) streaks.
   - **Six Degrees** — order six actors from a start to an end; each was in a film with the next. Characters with ↑ (film with the actor above) / ↓ (below) / ↕ (same role in both), Check (4 tries, right spots turn green, Wordle-style flip), 💡 Hint ×4 (three films side by side, then one actor placed), points out of 5, timeline ending with the five films and watchlist ribbons. Keyboard ↑↓ moves rows too. No levels yet. `data/six-chains.json`.
   - **Cast Call** — the captcha with posters: a face and nine posters, "Select 4 titles with ●●●●", Check flips them (hit / wrong / missed with the title / faded), Next. Seven faces in 60 seconds, +1 right / −1 wrong, +3 s for a perfect grid. 470 faces from the live catalogue. `data/cast-call.json`.
   - **Line-up** — Cast Call reversed: a poster and nine faces with their names, "Select 4 actors in ●●●●", the same clock, points, bonuses and end screen (the round's posters with x/4). 315 well-known posters (4,500+ TMDB votes) from the live catalogue. `data/line-up.json`.
   - **The Bet**, **Mind Reader** — after the season.
   - **Soon:** Choose the Ending, Movie Night Planner, Upgrade, Recast.
5. **Watchlist ribbon** on every poster saves into the app's one synced watchlist; a save counts as a taste signal.

## The games teach the real app (Slice 2 — landed 2026-10-21)

What "Behind the curtain" shows is what the live taste DNA registers: the scale beliefs, the genre chips (and "Never"), the creators they trust. It happens on the server after a save, at milestones, and each sync replaces what the previous one wrote. Details: `docs/INTEGRATION.md` (2026-10-21) and `docs/DNA-CONTRACT.md` ("The taste games as a writer"). Game reactions on single titles (`pickReactions`: Blind's "Seen it", The Other Side's ratings) are not written as title signals, by design.

## Rules Eran set (do not re-litigate)

- **Facts must be real.** TMDB data or film details checked against it; mark film-detail facts (`src: "film"`) for spot-checks. No AI-invented trivia.
- **No fake guessing.** Nothing claims to know the player until the brain predicts their picks clearly better than a coin flip (`readsYou` / `canHunch`). No score → no score, never "0".
- **Never repeat** a served item in a game (`S.served`), even across Games ↔ season step.
- **Memory, not guessing** (Six Degrees): hints jog memory (films, characters); a game must not be solvable by brute force alone.
- **Variety beats volume.** In Six Degrees a pair-and-film link appears once in the whole set, a film in ≤2 chains, a face in ≤3; Eran noticed repeats after six chains. Two+ women per chain; a hand list of faces too few would know.
- **Levels: finishing a level unlocks the next, whatever the score** (Eran, 2026-10-27, #150). No hidden score bars. A target only where it *is* the game and the end screen says it (Higher or Lower's streak).
- **Season games are always open.** No teaser picks, no meters or % on training screens. Confetti only when earned, dropped once.
- Eran dislikes jargon, meters that mean nothing, endless aimless loops, fake claims, and anything that looks "AI-generated".

## UI conventions for every game (Eran, 2026-10-24)

- **One button look:** every button on a game screen is a 56px pill with 18px text — orange gradient for the main action (`.cta` / `.opt.primary`), the same dark pill for the rest (`.opt`, `.ghost`). One rule under `.screen.game-screen` in `play.css` enforces it; render new games inside `GameScreen` and never add per-game button sizes.
- **Orange = the one action that answers or moves on** (Check, Next story, Start). Helpers and fallbacks (💡 Hint, Next clue) stay dark, even when they're the only button on screen.
- **"Seen it" ratings, app-wide (2026-10-27):** ❤️ Loved / 👍 Liked / 👎 Disliked, exactly the feed card's row: 13px prompt at 50% white, 8px, 36px pills 6px apart, 13.5px regular label at 70% white, emoji in its own opaque span (a 70% text colour fades emojis). The one exception to the 56px buttons. In games use `SeenChips` (`gameplay.tsx`).
- **Reusing a pattern from the app means matching it exactly.** Measure both in the running app (height, width, font size, weight, colours, gaps) and compare the numbers before calling it "the same". Mocks are full fidelity: real posters, fonts, buttons.
- **Every screen fits 375×812 with the longest content.** Check the longest title/text, not just a typical one; shrink the text before the poster.
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
| `lib/cast.ts` | Cast Call: deal a round (7 faces, easy → hard, repeats only after round 5, ≤2 returning, 3+ rounds apart, next grid each time, Never genres skipped), points; `pickRound` (the repeat rules, shared with Line-up) and `CastAsk` (one grid as the play screen draws it, for both games) |
| `lib/lineup.ts` | Line-up: deal a round of 7 posters with `pickRound` (one poster per franchise, no face on more than 2 posters, Never genres skipped); its own history `PlayState.lineup` |
| `lib/reveal.ts`, `lib/watchlist.ts`, `lib/demo.ts` | Season reveal; watchlist bridge (`SaveSource` per game); dev demo player |
| `lib/server.ts`, `lib/events.ts`, `components/persist.ts` | Saving to `play_state` / `play_events` |
| `components/PlayApp.tsx` | Controller: every action, screen flow, saving, game runs (`sixDealRun`, `blindAdvance`…) |
| `components/games.tsx` | Games tab (`GAMES` list), intro / over screens, `GameScreen` |
| `components/gameplay.tsx`, `six.tsx`, `cast.tsx` | Play screens (Blind, Other Side, Higher or Lower; Six Degrees; Cast Call and Line-up — one screen, `lu` switches what's asked and what's tapped — incl. the clock and end screen) |
| `components/Screens.tsx`, `season.tsx`, `watchlist.tsx`, `ui.tsx` | Season screens, watchlist, shared bits (`Poster`, `SaveRibbon`, `Marked`) |
| `play.css` | All styles, scoped under `.wtw-play` |
| `data/titles.json`, `ai-scores.json` | 980 pinned titles and their model scores |
| `data/blind-covers.json`, `six-chains.json`, `cast-call.json`, `line-up.json`, `other-clues.json`, `plot-rewrites.json` | Game content (`cast-call.json`, ~570 KB, and `line-up.json`, ~200 KB, load only when their game starts) |

**Scripts:**
- `npm run build-play-titles` — title set (read-only on Supabase; Mistral for scales). `-- --grow N` adds N gap-weighted titles and keeps the rest; `--select-only` is a dry run.
- `npm run build-six-chains` — Six Degrees chains from TMDB casts (cached in the OS temp folder). `KEEP`, `MAX_PER_*` and the `SKIP` face list are at the top. Searching inside a theme (restrict links to titles of a decade or genre) found 21 classics / 17 drama / 13 pre-2000 / 13 crime / 7 comedy chains on the 980 — themed levels are possible but need a face pass first.
- `npm run build-cast-call` — Cast Call faces and grids from the live catalogue (read-only) + TMDB person credits and movie series (cached in the OS temp folder). Thresholds, the hand `FRANCHISE` groups, `KNOWN_ALIAS` names and a `SKIP` face list are at the top; it re-checks every rule as it writes.
- `npm run build-line-up` — Line-up posters and grids from the live catalogue (read-only), Cast Call's 470 faces and the TMDB cache `build-cast-call` keeps (run that first; it fetches only faces missing from the cache). `SKIP` (posters) at the top.
- `scripts/check-play-plots.mts` — AI fact check of `plot-rewrites.json` (Groq free tier). It does not cover `blind-covers.json` stories yet.

**Tests:** `tests/unit/play-brain`, `play-titles` (data checks incl. Blind covers), `play-six` (logic + chain data), `play-cast` (grid data + round rules), `play-lineup` (grid data + round rules), `play-watchlist`; `tests/component/SixPlay.test.tsx`. Dev demo: `localhost:3000/play?demo=1` (`&jump=16` finished season, `&jump=14` final round, `&new=1` brand-new user). First load after a restart compiles for ~30 s.

**Working tips:** large data files go through Python one-off scripts in the session scratchpad; TMDB key in `.env.local` (`TMDB_API_KEY`) — never print it. If another branch needs a fix while uncommitted work sits in the checkout, use a `git worktree` in the scratchpad (symlink `node_modules` and `.env.local`), then remove it.

## Cast Call (built 2026-10-27 on `feat/cast-call`)

A fast, easy game, the "select all the traffic lights" captcha with posters. A face and nine posters; **7 faces a run** (was 10 until 2026-10-30: out of reach even for a strong player) (the run ends at the 10th face or at the buzzer: a finish line, and no point mashing through faces); **always 4 right** ("Select 4 titles with ●●●●"), Check lights up at 4, a fifth tap shakes until you untap one. 60 seconds; right +1, wrong −1; all four right = +3 seconds (pops big over the grid, flies into the clock). Check flips the posters (Wordle flip): hit = green inside stroke + character, wrong = red + dimmed, missed = dashed green + **title** + character, the rest fade. The clock pauses; the orange button becomes **Next** ("See my score" after the 10th). Top line: "FACE 3 OF 7 · SCORE 7". Last 10 s: red clock. Time's up: a red flash, the grid is checked as it stands, "Time's up · What you tapped still counts" → See my score. End screen (version A of three, then Eran's notes): SCORE and BEST tiles (NEW BEST tag + "was N"; "FIRST ROUND" on a first run); right / wrong / missed as a quiet line, not tiles (tiles under tiles read as a dashboard), then a divider; the heading right above the run's faces ("7 faces in 0:51" when all seven beat the clock, else "5 of 7 faces") with x/4 (green at 4/4), as big as the space allows (3 a row, up to 4 rows); a faded drifting wall of the run's posters; one button "Next round". Mock-ups and the playable page: `docs/prototypes/credit-check/` (`build-deck.py` → `deck.json`, `build-play.py` + `play.js.part` / `play.css.part` → `play.html`, a private Artifact: https://claude.ai/artifact/LgYV6KZNzqhehvmFFZXLgp). Named **Cast Call** (Eran, 2026-10-27; was "Credit Check", which the prototype folder keeps).

**Rules for the live build (Eran):**
- **English-language only, well-known faces and well-known titles.** Every poster in a grid from the same language as the face's titles (no Korean actor in Bollywood titles). 30–35% women is fine.
- **At most 2 posters from one franchise per grid**, right and wrong together. TMDB's series are too narrow ("X-Men" vs "Wolverine", "Iron Man" vs "Avengers"), so franchises are grouped by hand (`FRANCHISE` in `scripts/build-cast-call.mts`, first in the prototype's `build-deck.py`: Marvel, X-Men, DC, Batman, Middle-earth, Wizarding World, Spider-Man, Star Wars). Faces that can't fill a grid under it drop out (Radcliffe, Grint, Hemsworth…).
- **Repeats:** none in the first 5 rounds; after that at most 1–2 returning faces a round, each at least 2–3 rounds after it last appeared, with new posters where possible. Target: 25–30 good rounds.
- Right = top-6 billed, not voice / self / uncredited; wrong = **no credit at all** on the actor's full TMDB credits. Easy → hard inside a run (2 easy, 2 medium, 3 hard; tiers split separately for women and men, or one fame list puts nearly every woman in "hard"). Hard faces get co-stars' films as wrong posters.

**2026-10-30 changes (Eran):** 7 faces a round. Bonuses: a perfect grid is +2 points (and +3 s); finishing all seven with 21+ of 28 right turns every 2 seconds left into a point (random tapping gets ~12 right). The end screen says where the score came from ("26 from posters · +12 perfect grids · +28 time"), and bests from the old rules were cleared once (`castRulesUpdate`, `PlayState.cast.v`). Layout B: the live counter "FACE 3 OF 7 · SCORE 7" is the top bar's title, the "3 right · 1 wrong" line is gone (the banner says "3 of 4 · 1 wrong"), so the posters are 116px on a Pixel 10 Pro (412×772) instead of 102. The grid is sized on every face (a fresh grid used to go full width and push Check off a wide, short screen), Check stays pinned to the bottom, and it hides at Time's up. No auto-check: Eran wants the Check tap.

**As built:** `npm run build-cast-call` → 470 faces (150 women, 32%), 1,068 grids (most faces have 2–3), 2,939 titles. A Cast Call card in the Games tab (no levels; "N rounds played · best X"), intro with BEST / NEW, then `CastPlay` draws its own line "FACE 3 OF 7 · SCORE 7". Events: `cast_grid` (face, grid, picks, hits, wrong, perfect, buzzer) and `cast_done` (score, right, wrong, missed, faces, done, ms); best in `gameBest.cast`, round history in `PlayState.cast`. "How to play" pauses the clock (`RULES_EVENT`). The clock only counts drawn frames (≤250 ms each), so a player who switches apps doesn't come back to a lost round. Not done yet: a hand pass on the faces (`SKIP`), and the 30–40k-vote band of faces.

**Measured on the live catalog (2026-10-27, read-only):** 34,941 titles; 6,739 "known" (English ≥1,000 TMDB votes, others ≥300); 1,570 actors can fill a grid. By total votes on their known titles: ≥40k → 467 English faces (147 women: Blake Lively, Jon Hamm, Dev Patel…), ≥30k → 624 (203 women; the 30–40k band needs a hand pass). 7 faces a run → ~67 fresh runs at the 40k line. The catalog's `crew.cast` has billing order but no character names or voice flags: fetch those from TMDB in the build.

## Line-up (built 2026-10-30 on `feat/line-up`)

Cast Call reversed (Eran liked "one poster, nine faces, tap who was in it"). **Its own card** in the Games tab next to Cast Call (Eran, 2026-10-30): its own best, "N rounds played · best X", teal (`#17b3a3`), icon "L". Card and intro: "Seven posters, one minute. Find the four actors in each." Mock-ups (the seven states he approved, plus 375×667): `docs/prototypes/line-up/` (`make-mocks.py`); poster sizes compared (today, +20/25/30/35%, and +35% checked): `make-poster-sizes.py`.

**Same as Cast Call:** 7 a round (2 easy, 2 medium, 3 hard), 60 s, exactly 4 right of 9, +1 / −1, perfect grid +2 points and +3 s, time bonus at 21+ of 28, the counter in the top bar ("POSTER 3 OF 7 · SCORE 7"), Check pinned and hidden at Time's up, the repeat rules (none in the first 5 rounds, then ≤2 returning, 3+ rounds apart).

**What's different on screen:** the banner holds the poster at 65×98 (first built at 48×72; Eran wanted it 35% bigger, the faces paying for it) and "Select 4 actors in ●●●●"; the title is the question, so it is never cut: 17–32 characters wrap to 2 lines at 18px, longer ones to 3 at 15px (all 315 titles checked at 375×667: none cut, the banner's height never changes). Each face carries the actor's name (Eran: names on, so it's about the film, not face recognition); the name shrinks with the face when tapped and with small tiles (12–14px). Checked: right = green + character, missed = dashed green + MISSED + name + character, wrong = red. End screen: the round's posters four a row with x/4 (green outline at 4/4), the drifting wall shows the right faces, "N from faces · +X perfect grids · +Y time". Faces 106px on 412×772, 83 on 375×667. The poster has its own class (`cast-poster`): the app's `.poster` card class adds 10px of padding.

**Data rules (`scripts/build-line-up.mts`):** English-language, no animation / documentary / reality, and **4,500+ TMDB votes for a poster** (Eran, 2026-10-30: at 1,000+ about a quarter of the titles were unknown to him, and here an unknown title is pure luck, unlike Cast Call where you still know the actor; titles with 1,000+ votes still count for who worked with whom). A right face is one of Cast Call's 470 faces, billed in the top 8, a real on-screen part on their own TMDB credits (not voice, self, uncredited; series 5+ episodes), with a character name. A wrong face has no credit at all on the title (cast or crew) and isn't on its catalogue cast list; the wrong five match the right four's women/men mix (×5/4, rounded) and are known from the same years (±8, easy ±12); co-stars of the right four and same-genre faces are favoured on harder posters (easy posters get mostly random ones). Right faces rotate: less-used faces first, then billing order. **As built:** 315 posters (105 per tier by votes; the least-known: RED, Star Trek Beyond, Mamma Mia!, Ocean's Thirteen), one grid each (a second needs 8+ known faces, rare), 462 faces; ~45 fresh rounds. Floors compared: 5,000 → 290 posters, 8,000 → 185, 10,000 → 145. Events `lineup_grid` (title key, grid, picked face ids, hits, wrong, perfect, buzzer) and `lineup_done`; best in `gameBest.lineup`, history in `PlayState.lineup`.

**Not done yet:** a hand pass on posters whose cast is printed on the poster itself (ensemble posters make easy grids easier; `SKIP`), and whether the top-billed lead should always be among the right four (now the less-used face wins, so Revolutionary Road came without DiCaprio).

## Open items

- **Six Degrees themed levels** — the data exists (see above); needs Eran's choice of themes and a face pass.
- **Blind stories' fact check** — extend `check-play-plots.mts` to `blind-covers.json`.
- **A stray change** in `PlayApp.tsx` (unknown game id → default accent) still sits uncommitted in Eran's checkout (seen 2026-10-25 and 2026-10-27), author unknown; leave it out of commits and ask Shahar.
- **Review bot** (`claude-review`): it failed instantly on 2026-10-24 (likely an expired token) and worked again once Shahar re-ran it. On #149 and #150 (2026-10-27) it passed in 3–8 seconds and posted nothing: it isn't really reviewing. Review the diff yourself and run `npx vitest run` before merging; ask Shahar to look at the bot.

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
