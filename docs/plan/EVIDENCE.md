# Evidence behind docs/plan/PLAN.md

This is the deck "WTW engine: how it ranks and how to make it better" (8 Nov 2026) in text form, for Claude.
- **Who was measured:** Eran, Shahar and Alon, with Alon's and Shahar's permission.
- **What stays out of git:** the raw answers and the scripts (`docs/prototypes/rate-run/taste-test/`, local only), because the repo is public. Only the numbers below are recorded here.
- **The deck itself, for people:** a claude.ai artifact. Eran shares the link.

## M · Method

1. Each tester marked about 100 well-known titles from across genres: loved / liked / disliked / haven't seen. The sheet sizes were Eran 130, Shahar 100, Alon 100.
   - Keeping only titles they had seen: 91 / 87 / 86.
   - Then dropping titles already in their My ratings ("fair titles"): **85 / 47 / 61**.
2. The engine scored each fair title using that person's live DNA, without seeing their answers.
3. **The score is pairwise concordance**, the three-level version of AUC:
   - Over every pair of titles rated at different levels, it is the share where the preferred title scores higher. Ties count half.
   - Pairs per tester: 2,196 / 734 / 1,176.
   - 50 = a coin flip.
   - **L/D** = the same score over loved-vs-disliked pairs only. That is the mistake users notice.
4. **Consistency check:** Shahar rated 45 titles both on the sheet and in My ratings. 35 matched, and none flipped between loved and disliked.
5. **New-user simulations:**
   - 20 hidden fair titles per draw, 200 draws.
   - Cards are drawn at random from everything else the person rated.
   - Picks are the person's first season `duel` answers, in order; pairs that touch a test title are dropped.
6. **Crowd** = the engine's formula: `0.6·tmdb/10 + 0.4·omdb`, where OMDB is stored 0–1 and a missing half is rescaled properly. An earlier run read OMDB as 0–10; it was fixed on 8 Nov.

## 1 · Today's engine, part by part (concordance)

| Part | Weight | Eran | Shahar | Alon |
|---|---|---|---|---|
| Creators | 0.32 | 62 | 61 | 60 |
| Story match | 0.25 | 52 | 47 | 43 |
| Pace & tone | 0.15 | 54 | 47 | 42 |
| Genre habits | 0.15 | 50 | 40 | 50 |
| Crowd | 0.12 | 65 | 47 | 66 |
| **Engine score** | | **57** | **47** | **47** |
| Engine L/D | | 65 | 44 | 42 |

- **Recency** (0.01) scored 48–49 for all three testers.
- **Story match misses** because the profile embedding is built only from strand B + C text: no quality signal, no titles, no creators.
  - The same cosine run straight on My ratings scored 62 / 44–48 / 54.
- **The parts are on different scales**, so the weights don't do what they say. Z-scoring them alone gains 4–12 points.

## 2 · Searching for the best mix (3,003 weightings in 10% steps; L/D in brackets)

| Recipe | Eran | Shahar | Alon |
|---|---|---|---|
| Today | 57 (65) | 47 (44) | 47 (42) |
| Same weights, parts z-scored | 61 (72) | 53 (54) | 59 (56) |
| Without story match | 64 (77) | 55 (57) | 63 (65) |
| …also without pace & tone | 65 (76) | 56 (59) | 65 (74) |
| …also without genre habits | 68 (78) | 60 (65) | 65 (72) |
| Creators 60 + crowd 40 | 70 (81) | 60 (64) | 67 (75) |
| **Creators 30 + crowd 20 + taste model 50** | 76 (91) | 62 (68) | 71 (81) |

- **This table is a best case:** here the taste model trained on the sheet itself.
- **The top of the table is a plateau.** The best 29 mixes put 30–70% on the taste model and little or nothing on story, pace or genre habits.
  - At 30 cards + 12 picks: crowd 30 + model 70, creators 15 + crowd 25 + model 60, and the model alone all land within about 2 points of 30/20/50.

**Realistic numbers, with the model trained only on My ratings** (as the app would). These are the gate baseline in PLAN P1-G.

| | Eran | Shahar | Alon |
|---|---|---|---|
| Concordance | 57 → **69** | 47 → **61** | 47 → **72** |
| L/D | 65 → **81** | 44 → **67** | 42 → **83** |

My-ratings training rows among the 980 titles with scales: Eran 27, Shahar 234, Alon 84.

## 3 · The taste model on its own (each title held out in turn; L/D in brackets)

| Method | Eran | Shahar | Alon |
|---|---|---|---|
| Engine today | 57 (65) | 47 (44) | 47 (42) |
| Crowd alone | 66 (72) | 45 (43) | 68 (77) |
| Taste model alone | 71 (86) | 61 (64) | 67 (74) |

- Trained only on My ratings, the model alone scores 59 / 59 / 69.
- Trained on shuffled answers (the control), it scores about 50.
- The model works for all three testers because it learns how much each one follows the crowd.

## R · Reference recipe (for the port to TypeScript, PLAN P1-D4)

- **Inputs (24):**
  - `z(tmdb_rating)`, using the mean 7.6258 and sd 0.6436 of the 980 game titles;
  - 13 game genres at `1/n` each, sorted `action, anim, anime, comedy, crime, doc, drama, family, horror, romance, scifi, thriller, war`;
  - 10 scales, sorted `commit, complex, dark, energy, fantastic, humor, indie, modern, pace, tone`, with a missing scale = 0.
  - (The ±3 clamp on the rating input is new in PLAN, not part of the tests.)
- **Targets:** loved 3, liked 2, disliked 1, minus the mean of the person's levels.
- **Pairs:** `x_chosen − x_other` with target 1.0.
- **Ridge, no intercept:** penalty 0.5 on the rating input and 4.0 on the other 23. These were fixed before any scoring.
- **Score:** `w·x`.
- **Formula:** z-score creators, crowd and model within the candidate set, then `0.30·zc + 0.20·zw + 0.50·zm`.
- **Creators** were rebuilt from the cards exactly as `update-crew.ts` + `crew-affinity.ts` do:
  - role weights: directors .40, writers .30, cinematographers .15, the top 3 cast .15;
  - a dislike leaves people alone.
- **The 10 scales** (left ↔ right): serious–funny, talk–action, slow burn–fast, light–dark, easy watch–puzzle, real world–other worlds, classic–recent, blockbuster–off-beat, silly–dry wit (comedies only), mini-series–long haul (series only).
  - 7 are AI judgements: `scripts/build-play-titles.mts`, cached in `src/app/play/data/ai-scores.json`.
  - 3 are facts: year, fame (votes) and episode count.

## 4 · A new user: how many cards (concordance)

| Seen cards | Eran | Shahar | Alon |
|---|---|---|---|
| 0 (today's new user: crowd only) | 62 | 48 | 65 |
| 10 | 65 | 52 | 66 |
| 20 | 68 | 54 | 70 |
| 30 | 70 | 56 | 72 |
| 40 | 71 | 57 | 72 |
| 50 | 71 | 57 | 73 |

- About 30 seen cards gets most of the way. To get 30 seen, show about 35–45.
- Choosing each next card adaptively from the answers so far did no better at 30 cards: +1, −3, +1.

## 5 · This-or-that after 30 cards (L/D in brackets)

| | Eran | Shahar | Alon |
|---|---|---|---|
| 30 cards | 70 (82) | 56 (59) | 72 (82) |
| + 6 picks | 72 (85) | 61 (67) | 74 (84) |
| **+ 12 picks** | **73 (84)** | **63 (70)** | **75 (85)** |
| + 12 more cards instead | 70 (83) | 57 (61) | 73 (83) |

- Gains flatten after about 12 picks.
- The season's picker chooses each pair to test one scale; that is why picks beat extra cards.

## 6 · A first-time user, start to finish

| | Just signed up | After 30 cards | + 12 picks |
|---|---|---|---|
| Eran | 62 | 70 | 73 |
| Shahar | 48 | 56 | 63 |
| Alon | 65 | 72 | 75 |

- **L/D:** 70 / 47 / 73 → 82 / 59 / 82 → 84 / 70 / 85.
- **Random-answer control:** 57 / 51 / 58 (L/D 60 / 51 / 61).
- **Without the taste model** (creators + crowd only), 30 cards reach 65 / 51 / 67. Creators need about 100 ratings before they matter.
- **Top 5 of 20, loved % / disliked %**, just signed up → + 12 picks:

  | | Just signed up | + 12 picks |
  |---|---|---|
  | Eran | 56 / 11 | 70 / 2 |
  | Shahar | 46 / 44 | 42 / 22 |
  | Alon | 54 / 7 | 80 / 1 |

  - Shahar is the hard case: fewer dislikes on top, but not more loves.
- TMDB's "people also liked" lists were tried as a 4th part: 0–1 point. Left out.

## 7 · The season (only Eran and Shahar finished one; scored on titles the season never showed)

| | Just signed up | Season only | Cards + picks | Both |
|---|---|---|---|---|
| Eran | 64 | 64 | 71 | 72 |
| Shahar | 44 | 61 | 57 | 61 |

- **L/D:** 74 / 50, 76 / 66, 82 / 62, 85 / 68.
- **Today's engine** on the same titles: 59 / 40.
- **"Season only"** = the season's own brain (`predict` in `src/app/play/lib/brain.ts`) scoring from the saved season alone.
- Shahar's row rests on 25 titles.
- **Decision:** the season is an optional extra, not the way in.

## 8 · Option B, if the scales could not be extended

- **Using today's database tags** (pacing_tag, tone_tags, narrative_metadata) instead of the 10 scales, a new user with 30 cards + 12 picks scores:

  | | Option B (tags) | 10 scales |
  |---|---|---|
  | Eran | 71 | 73 |
  | Shahar | 57 | 63 |
  | Alon | 72 | 75 |

  Option A (scales on every title) was chosen.
- **The catalogue:** 34,973 titles (26,744 movies + 8,229 series).
- **The cost of option A:** about 3,500 calls at 10 titles per call, then about 60 new titles a day. The Mistral quota had not been checked yet; that is PLAN P1-D2 step 1.

## 9 · Chat rules (why D5 and D6)

**Rules are applied before scoring, silently and permanently.** Real cases:

| What was said | What got saved | What it hid |
|---|---|---|
| Alon: "are not in the correct genre" | Never: dramas | 39 titles he loved, among them The Godfather and Shawshank; 54 he loved or liked in total |
| Alon: "I want short 90 minute film" | Never: longer series | The opposite of what he meant |
| Shahar: "do not show me musicals" | Never: all music films | Whiplash, which he loved |
| Shahar typed "Cartoon" | Never: all animation | 12 titles he loved, mostly Pixar |
| Shahar: "no rom-coms" | Never: all romance | Her, Eternal Sunshine. Romance is 4,728 of 34,973 titles. |
| Alon asked for IMDb 8+, recent releases… | 19 "show less of" entries | Wishes turned into dislikes |

- **The code involved:** extraction in `src/modules/session/analyze-session.ts` + `directive-patterns.ts`; the merge in `src/modules/dna/lib/apply-directives.ts`; the widening in `src/lib/exclusion-rules.ts`.

## 10 · Jev (step 4) — counts across all three testers: 84 loved, 41 disliked fair titles

| Jev drops a title when it is… | Dislikes caught | Loved titles lost |
|---|---|---|
| 70% sure (before) | 76% (31) | 54% (45) |
| 80% sure (live since 7 Nov, PR #221) | 56% (23) | 29% (24) |
| 90% sure | 27% (11) | 5% (4) |

**On the new formula** (the top half of each ranking reaches Jev):

| Ranking, Jev setting | Dislikes caught | Loved titles lost |
|---|---|---|
| Today's ranking, 80% | 65% | 37% |
| New formula, 80% | 50% | 21% |
| New formula, 90% | 33% | 7% |

- **What reaches Jev:** the new formula already sends 12 dislikes (not 20) and 58 loved titles (not 41).
- **Jev at 80% on top of it** drops 12 loved titles to catch 6 dislikes.
- **What is left on screen:**

  | Setup | Loved | Disliked |
  |---|---|---|
  | Today + Jev | 26 | 7 |
  | New formula, no Jev | 58 | 12 |
  | New formula + Jev | 46 | 6 |

- **Jev's input bugs:** the favourite crew needs a score > 0.3, but scores top out at 0.30. "Family (11 rated down)" prints every rating of a genre that averages about neutral.
- **The rule:** fix what Jev is told, then retest. If it still costs more loves than it saves, switch it off.

## 11 · Step 1 and lesser-known titles (8 Nov)

- **With 30 cards a new user is past the cold-start line.** Their pool is 150 most-voted unrated titles plus 150 nearest by embedding (≥ 1,000 votes).
- **Of the top 150 most-voted movies each tester answered**, they had already seen Eran 58/72, Shahar 95/99, Alon 80/84 (81–96%).
- **Loved titles under 1,000 votes**, which the taste pool can never offer: Eran 0/93, Alon 1/73, Shahar 38/291 (mostly series).
  - Only 545 series clear 1,000 votes, against 4,613 movies.
- **Lesser-known titles** (Shahar's My ratings, using the database-tag model, crowd only → 30 cards):

  | Votes | Crowd only | 30 cards |
  |---|---|---|
  | Under 1,000 (85 titles) | 54 | 60 |
  | Under 5,000 | 58 | 62 |
  | 5,000–10,000 | 52 | 58 |
  | 10,000+ | 54 | 60 |

  - Eran's 80 is left out (his set was separable by genre). Alon has too few lesser-known ratings.

## Caveats

- Only three testers, two of them with a season. Treat gaps of 2–3 points as noise.
- The test titles are well-known. The card set used in the tests was each tester's own past ratings, not a set picked for the job.
- **Still untested:** a real card set (PLAN P2-U1), the taste pool in step 1 (R2), the scales on lesser-known titles (R3), and steps 3–4 on the new formula (R1).
