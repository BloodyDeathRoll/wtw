# Evidence for the next round: For you and Watchlist

Measured on 2026-11-16, before any decision, the same way as `docs/plan/EVIDENCE.md` was for v2.
- **Who was measured:** every account the database has a feed for (9).
  - **Shahar = the "Ein Hanamer" account only.** Shahar says it is his only real account (2026-11-16). His other accounts count with everyone else.
  - Eran, Shahar and Alon are named; everyone else is counted only in totals.
- **What stays out of git:** the scripts (`docs/prototypes/next-round-evidence/`, local only, excluded in `.git/info/exclude`) and any per-person title lists, because the repo is public. Only the numbers below are recorded here.
- **Not yet done:** clicking through the screens in the app, as a truly new account and as the test account. That needs Eran to sign in (§6).

## The evidence in plain words (for people; Claude, read on below)

1. **The feed shows the same titles over and over.** Of the 3,454 titles it has ever shown, 45% were shown more than once, and Shahar saw one title 39 times. Most of the repeats are cards nobody reacted to.
2. **Most cards get no reaction at all.** 60% of everything shown was never rated or removed: Eran 76%, Shahar 48%, Alon 71%.
3. **Coming back to For you starts over at the top of the list.**
   - If you saved nothing, it's the same list minus what you rated or removed, so the cards you scrolled past come first again.
   - If you saved or unsaved a title, leaving rebuilds the list, and the cards you passed may come back later, in the repeats from point 1.
   - A rating doesn't change the list until "Find more" or 6 hours.
4. **Rated titles never come back** (0 cases). That part works.
5. **Saved titles sometimes come back:** 7 of 51 Watchlist titles were later shown on the feed again (Eran 5 of 16).
6. **"Why it's a match" on the feed is real now.**
   - v2 fixed the guessed bars: every card in the live batches has the three real ones.
   - But on 29 of Eran's 50, nobody you follow is in the title, and the Creators bar still shows a number (for example 27%) that reads like "you like these people 27%".
7. **"Why it's a match" on the Watchlist is mostly old.** A saved title keeps the breakdown from the day it was saved. Of the three of us's 88 saved titles, 36 have the real bars, 22 still show the old guessed bars, and 30 have no breakdown at all.
8. **Where to watch is mostly wrong for Israel.**
   - On 177 real feed and Watchlist titles, the card names a US service for 99 that don't stream anywhere in Israel. Only 29 (16%) name a service that streams in both.
   - The data source (TMDB, which gets it from JustWatch) has no yes, HOT, Cellcom, Partner, Sting, freeTV or even Disney+ for Israel. So Israeli data would cover Netflix, Prime Video, Apple TV, HBO Max and some small services, and nothing else.
   - With Israeli data, 34 of the 177 (19%) would say Netflix, Prime Video, Apple TV or HBO Max. For the other 81% we can't tell: it may be on yes, HOT or the others, or nowhere.
9. **A long Watchlist has nothing to find things with.** Alon's 55 titles sit on 11 different services plus 18 with none, and Netflix, the biggest, has 7. You can sort it but not filter or search it, and it pages 6 big cards at a time.
10. **Two of the app's own rules aren't met on For you.**
    - The stretch pick (1 in 20, "never hidden") has no label on the card.
    - The JustWatch credit that TMDB's terms require wherever we show a service was removed on 2026-08-29, and the code says it must come back before a public launch.

---

## 0 · For you today: the rules (from the code, flags as in production plus NAV_TABS)

**Opening it.**
- The app opens on For you (`NAV_TABS`).
- The first list is built while the app loads (the "warm-up"); until it is ready you see "Reading your fingerprint · Finding matches" with the swirl.

**The list ("a batch").**
- **Size:** built 50 titles at a time and kept for 6 hours (`step8-cache.ts`).
- **Paging:** the screen shows 6 and loads 6 more as you scroll, up to the 50.
- **At the end:** a "Find more" button. It updates your profile, builds a new 50 and adds it under the old cards.
- **Movies / Series / Both:** each one is its own batch.

**What goes into a batch** (`pipeline/`).
- **Before the profile is ready** (fewer than 10 ratings and no finished season): popular, well-rated titles from the last 8 years (1,000+ votes, 6.5+). They turn more personal with each game and rating (`cold-start.ts`).
- **After that:**
  - 80% titles you were never shown and 20% titles shown before but never touched, least-shown first (`step3b`).
  - Ordered by the v2 match.
  - Kids' titles are capped (3 at the start, more as you rate kids' titles well) and spaced 5 apart (`kids-share.ts`).
  - A genre you turned up fills at most half (`turned-up-cap.ts`).
  - A **stretch pick** goes in at places 20 and 40 once you have 15 ratings and 3 sessions (`step5`).
- **Never shown:** anything you rated, removed with the X, saved to the Watchlist, or a genre you set to Never (`rec-page.ts`).

**The card** (`FeedCard`, top to bottom):
- **Poster**, with the service as a pill (US listing) and the match ring.
- **Title, year and length**, with Share and Trailer.
- **One line of "why"**: the plot, or a person you love. Tapping it, or "Why it's a match ›", opens the sheet with three bars (Your taste · Crowd · Creators), "What it's like", and the people you follow.
- **Add to Watchlist and the X.** The X means "not for me, never again": the card slides away. A saved card stays on the list, marked saved, and has no X.
- **Loved / Liked / Disliked.** The button stays lit, the card stays where it is, and it can be un-rated.

**Between cards.**
- **"Sharper picks":** after every 15th card, for players who skipped part of the games; it sends you to the games.
- **The 48-hour check-in:** it sits just above the tab bar, one at a time.

**Leaving and coming back.**
- The tab bar switches screens, and For you forgets its cards and your place.
- If you saved or unsaved anything, leaving rebuilds the batch (`syncSaves` → session end).
- Back on For you, it pages from the top of the current batch, minus what you rated, removed or saved.
- A rating alone doesn't rebuild anything: ratings are folded in lightly and the list stays, until "Find more", a save, or 6 hours (`merge-feedback-signal.ts`).

## M · Method

- **Source:** the production database, read-only, with the service key.
  - `served_titles`: every title each account was shown, with times shown and first and last time.
  - `recommendation_feedback`: ratings.
  - `removed_titles`: the X.
  - `watchlist_entries`: saves, with the saved "Why" snapshot.
  - The live batches in Redis (`rec4:*`, kept 6 hours).
- **Where to watch:** each title's stored US listing, read through the card's own function (`primaryWatchProvider(…, 'US')`), against TMDB's `/watch/providers` Israeli list, fetched live. TMDB's full list of services it knows for Israel came from `/watch/providers/{movie,tv}?watch_region=IL`.
- **"Came back":** shown again more than a minute after it was rated or saved.
- **"Never acted on":** never rated and never removed. A title saved but never rated counts as never acted on (51 in all).

## 1 · The feed: repeats and cards with no reaction

Since each person's first feed (Eran and Shahar over about 71 days, Alon on one day).

| | Titles shown | Showings | Shown more than once | Most times one title | Rated | Removed | Never acted on | …and shown again |
|---|---|---|---|---|---|---|---|---|
| Eran | 702 | 1,441 | 387 (55%) | 8 | 145 | 26 | 531 (76%) | 327 |
| Shahar | 2,003 | 5,641 | 1,003 (50%) | 39 | 865 | 169 | 969 (48%) | 641 |
| Alon | 210 | 228 | 12 (6%) | 3 | 61 | 0 | 149 (71%) | 12 |
| **All accounts** | **3,454** | **8,087** | **1,566 (45%)** | 39 | 1,195 | 201 | **2,058 (60%)** | **1,108** |

- **Rated, then shown again:** 0 on every account.
- **Saved to the Watchlist, then shown again:** 7 of 51 (Eran 5 of 16, Shahar 1 of 13, Alon 0 of 21, others 1 of 1).
- **Why the repeats happen:** the 20% "shown before, never touched" share of every batch (§0), plus coming back to the same batch from the top.
- **For Shahar's #240 ask** ("count the skipped cards"): the "never acted on" column is that count, 48–76% of everything shown.

## 2 · "Why it's a match"

**On the feed** (Eran's live batch, 50 titles, formula v2):
- **Real bars:** 50 of 50 have the three real bars. None has the old guessed set (Narrative = the match itself, Mood & pace = match × 0.88, Recency = always 88%). The backlog row "Two of the five Why bars are guesses" is fixed for the feed.
- **Someone you follow:** 21 of 50 have at least one person you rated well; 29 of 50 have nobody.
- **The Creators bar** is the title's standing in the batch on that part, so it is never empty. *The Big Bang Theory*, with nobody you follow, shows Creators 27%. The backlog question "what does the Crew bar mean" still stands under its new name.

**On the Watchlist** (the snapshot saved with each title):

| | Saved | Real bars | Old guessed bars | No breakdown saved |
|---|---|---|---|---|
| Eran | 17 | 4 | 8 | 5 |
| Shahar | 16 | 1 | 9 | 6 |
| Alon | 55 | 31 | 5 | 19 |
| **Total** | **88** | **36 (41%)** | **22 (25%)** | **30 (34%)** |

- **No breakdown saved:** the sheet then looks for the title in today's batch. It finds it only rarely, since saved titles are kept off the feed. Otherwise it shows the written "Why" alone, or an error.
- **Cast without character names:** not measured. It is a known data gap (`titles.crew.cast` has no `character`).

## 3 · Where to watch

177 different titles: the live feed batches plus the three of us's Watchlists.

| What the card says vs Israel | Titles |
|---|---|
| Names a US service that also streams it in Israel | 29 (16%) |
| Names a US service, but it streams nowhere in Israel (rent/buy only, or nothing) | 99 (56%) |
| Names a US service; it streams in Israel on a different one | 8 (5%) |
| Shows no service, and it streams nowhere in Israel | 40 (23%) |
| Shows no service, but it streams in Israel | 1 (1%) |

- **Streams nowhere in Israel** (by TMDB): 139 of 177 (79%).
- **On Netflix, Prime Video, Apple TV or HBO Max in Israel:** 34 of 177 (19%). This is the most an Israeli card could ever say today.
- **US services named that don't exist in Israel at all:** Peacock, Hulu, Paramount+, Lionsgate+, YouTube TV, fuboTV, Philo, Starz, Cinemax, MGM+, Criterion.
- **What TMDB knows for Israel** (all of it, 2026-11-16): 35 services for movies, 24 for series.
  - **Ones people know:** Netflix, Amazon Prime Video, Apple TV, HBO Max and MUBI.
  - **The rest are niche:** Crunchyroll, Rakuten Viki, Plex, iQIYI, Shahid, Zee5 and others.
  - **Missing:** yes, HOT, Cellcom TV, Partner TV, Sting+, freeTV and Disney+.
- **Eran, from memory:** *Euphoria* and *Parasite* aren't on yes. He doesn't know about the others.
- **Other data sources** (searched 2026-11-16):
  - No API found that covers the Israeli TV companies' libraries.
  - JustWatch's own Israeli site shows the same kind of list as TMDB.
  - FlixPatrol offers an API on request; whether it covers yes or HOT is unconfirmed.
- **The JustWatch credit:** TMDB's terms require it wherever availability is shown. It was removed on 2026-08-29 (`WhereBadge` in `RecommendationsView.tsx`).

## 4 · The Watchlist with a long list

| | Saved | Movies / Series | Watched and rated, still listed | Services the card names (US) |
|---|---|---|---|---|
| Alon | 55 | 35 / 20 | 0 | 11 different, + 18 with none. Largest: Netflix 7 |
| Shahar | 16 | 15 / 1 | 3 | 7 different, + 6 with none |
| Eran | 17 | 14 / 3 | 2 | 8 different, + 5 with none |

- **Paging:** 6 cards a page, so Alon's 55th title is 10 pages down.
- **What it offers today** (code): sort by Year, Date added, Rating or Name. There is no filter by service, no search, and no movies / series split; the Movies / Series / Both control is deliberately left off the Watchlist (`docs/watchlist-plan.md` #3).
- **Rated titles stay on it** by design, tagged with the rating, until "Remove from watchlist".

## 5 · The app's own rules, checked on For you

| Rule (CLAUDE.md) | Today |
|---|---|
| Stretch picks: 1 in 20, labelled, never hidden | The engine puts them in (places 20 and 40). The card shows no label: `is_stretch_pick` reaches the card but nothing displays it. |
| Every recommendation has a "Why this?" with positive AND negative signals | On the feed, yes ("Why it's a match"; a person you rated down shows as a reason against). On the Watchlist, 25% show the old guessed bars and 34% have no breakdown (§2). |
| Regret signal, 48 hours after watching | Shown on For you, above the tab bar. It starts only from rating a Watchlist title, so most ratings never trigger it (backlog). |

## 6 · Not yet measured (needs Eran)

- **Click-through on the real screens** (For you ↔ Watchlist ↔ You, add to Watchlist, rate 20, come back):
  - The code above already shows the result.
  - The click-through would show it on screen, and time it on a production build.
  - It needs the browser pane signed in to the test account (Eran signs in).
- **A truly new account:** one created for this check, not a reset one (lesson from #333). Creating it is Eran's call.

## Caveats

- **Small numbers:** three real users and a few friends and test accounts. Alon used the feed on one day only, so his repeat numbers are low by construction.
- **One batch for the feed "Why" numbers:** only Eran's batch was live then. The 6-hour cache had expired for everyone else.
- **TMDB's Israeli data is incomplete** in ways we can't measure, since none of the local TV companies is in it.
