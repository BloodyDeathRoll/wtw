# 16 genres: what the signed-off genre screen needs underneath

*Written 2026-11-12 night (Eran + Claude), while starting #243 (P2-U2).* **Decided 2026-11-13: option A** (Eran), pending Alon's and Shahar's OK on the parts in their code.

## In plain words

The genre screen Eran signed off (#241) shows **16** genres. The app's genre list in code (`GAME_GENRES`, `src/app/play/lib/genres.ts`) has **13**:

| Screen (16) | Code today (13) |
|---|---|
| Sci-fi · Fantasy · Superheroes | one: "Sci-fi & fantasy" (`scifi`) |
| Adult animation · Kids' animation | one: "Animation" (`anim`) |
| Family & kids (live-action only) | "Family & kids" (`family`, includes animated family films) |
| the other 10 | the same 10 |

The answers have to mean exactly what the screen says: **"Never: Superheroes" must hide superhero films only, not all sci-fi**, and "Never: Kids' animation" must not hide BoJack. The 13 can't say that, so the list has to grow. That list is used in about 20 places, across three people's areas. That's why this is written down first, not done overnight.

## Where the 13 are used

| Area | Files | Owner | What would change |
|---|---|---|---|
| The list and how a title gets its genres | `src/app/play/lib/genres.ts` | games (Eran) | 3 new ids; new matching (below) |
| What a rule hides | `src/lib/exclusion-rules.ts` | shared | genre rules for the 3 new ids, using keywords as well as TMDB genres |
| Taste model inputs | `src/lib/taste-scales/features.ts` | Shahar | **must not change**: map the new ids back onto the 13 inputs, so every stored `taste_vec` stays valid |
| Genres stored per catalogue title | `titles.game_genres` (D2 backfill), `normalise.ts`, `prompt.ts` | Shahar | recompute the 3 new ids by rule (keywords + TMDB genres, no AI calls) |
| The 980 game titles | `src/app/play/data/titles.json`, `scripts/build-play-titles.mts` | games | rebuild with the new ids |
| Starter feed for brand-new users | `src/modules/engine/pipeline/cold-start.ts` | Alon | follows `GAME_GENRES`; check only |
| "Why this?" wording | `src/modules/engine/why/taste-facts.ts` (`GENRE_SAY`) | Alon | follows the model's 13 inputs; unchanged if the inputs are kept |
| Genre answers → Taste DNA and rules | `src/modules/dna/update-from-play.ts` (`GENRE_NAMES`, `NEVER_RULE_NAMES`) | A3 | entries for the 3 new ids |
| The season (Games tab) | `brain.ts`, `blocks.ts`, `select.ts`, … | games | keeps working on whatever ids titles carry; saved seasons get the new chips as "no answer" (`withAllGenres`, as for Family & kids on 2026-11-06) |

## How each new genre is matched (proposal)

| Genre | A title belongs to it when… |
|---|---|
| **Superheroes** (`hero`) | it has the TMDB keyword `superhero` (the 980 already carry this as `groups: ['superhero']`) |
| **Sci-fi** (`scifi`) | TMDB Science Fiction, or TV "Sci-Fi & Fantasy" with sci-fi keywords; **not** a superhero title |
| **Fantasy** (`fantasy`) | TMDB Fantasy, or TV "Sci-Fi & Fantasy" with fantasy keywords; **not** a superhero title |
| **Adult animation** (`adultanim`) | TMDB keyword `adult animation` |
| **Kids' animation** (`anim`, relabelled) | Animation + (Family or Kids), and not adult animation, not anime |
| **Family & kids** (`family`) | Family or Kids, and **not** Animation |

These are the rules already in PLAN.md §9's table; this adds where they live.

## The two ways to do it

**A · Grow the list to 16 everywhere (recommended).** One foundation PR, landed before #243 (GITGUIDE: foundation changes go in first, owned by one person). The model's 13 inputs stay as they are (new ids map back: `hero`/`fantasy` → `scifi`, `adultanim` → `anim`), so the formula and every stored vector are untouched. The answers mean exactly what the screen says, and the Taste DNA rule picker (#249) gets the same 16 for free.
*Cost:* about 1–2 days, touching three people's files, so it needs Alon and Shahar to agree, and Shahar to recompute `game_genres` for the catalogue (rule-based, no AI).

**B · Keep 13 in code; translate on the genre screen only.** The screen shows 16, and each chip translates into today's machinery: Never on Superheroes becomes a keyword rule `superhero`; Love on Fantasy leans the old `scifi`; and so on.
*Cost:* small, onboarding-only. **But it's imprecise where it matters:** there's no rule today that hides "kids' animation but not adult animation", or "live-action family but not Pixar", so some Nevers would hide too much or too little. The rule picker (#249) would need the same translation again.

## What #243 needs

Option A landed first. Then #243 is mostly UI: the signed-off screen (`docs/prototypes/first-run/1-genres-*`), saving answers as the season does (`play_state.state.gen`), Nevers through `update-from-play.ts`.

**Decided: A, done side by side** (2026-11-13). Building it showed that mapping the 16 back onto the 13 can't be exact (*The Dark Knight* is "Superheroes" but was never "sci-fi"), so it would have changed taste vectors. Instead:
- **The 13 stay exactly as they are** for the taste model, the stored `game_genres` and the season. Nothing changes in Alon's or Shahar's code; no recompute.
- **The 16 are added** (`src/app/play/lib/genres16.ts`) for what people see and choose, and a Never on them is exact (`genre16Rule()` in `exclusion-rules.ts`). Love / Like reach the 13 through `GENRE_13_OF` (quick picks, the genre lean #278).
- Foundation PR: #285. Then #243 builds the screen on top.
