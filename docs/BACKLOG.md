# Backlog

Things we've decided to come back to. Newest first. When one gets picked up, move it to `docs/INTEGRATION.md`; when it ships, delete it here.

| Added | Item | Notes |
|---|---|---|
| 2026-11-12 | **The menu (☰): rethink it as a whole. Eran, very important** | Eran wants to handle the whole menu himself, first thing over the weekend of 2026-11-14. **Today:** one drawer (`src/modules/session/components/AppMenu.tsx`) with Recommendations, Watchlist, Games (`play`), My ratings, Taste DNA (`profile`), Voice, Sign out. The season hides items by stage (`src/app/play/components/ui.tsx`): before genres only Sign out (`NOTHING_YET`); a new user then sees Watchlist, Games, Voice, Sign out until the season is done (`NEW_USER`). **Parked inside it:** during the new onboarding (#241) the menu shows **Sign out only** (decided 2026-11-12 so the build isn't blocked, but Eran is unsure). **Questions:** what each kind of user sees (brand-new, mid-onboarding, done); whether Games and Voice belong in the main menu; where search lives; what replaces the hidden chat (`CHAT_MODE=off`, DEC-5). |
| 2026-11-06 | **Recommendations: "Clear all seen" in one tap** | Rated cards stay in place now (the Seen task), so after rating a lot while scrolling, the feed fills up with titles you've already seen, and clearing them one by one is a chore. Add one action that clears every card you've rated from the list in one go, something like WhatsApp's "Archived" row at the top of the chat list. They're already in Seen, so nothing is lost. Decide where it sits (top of the list, or next to Movies / Series / Both) and whether it shows only once there's something to clear, with a count ("Clear 12 seen"). Related: [Seen — task details](#seen--task-details) and "never lose picks, never pile up". |
| 2026-11-06 | **Adding a title to the Watchlist takes it off Recommendations** | Eran (2026-11-06): Add to Watchlist moves the title off the recommendation list. Today the card stays on the feed until you leave and come back (the server already drops saved titles from the next load). Make it leave right away, with a light animation and a short "Moved to Watchlist" note that fades by itself. The Seen task's rule is updated to match: only the X, Add to Watchlist or "Remove from Watchlist" takes a title off a list; a rating never does. |
| 2026-11-06 | **"Watching with the kids tonight"** | The kids' share (`kids-share.ts`) lifts for one batch when the session request mentions kids/family. A proper mode — say it in chat, or a toggle — that switches kids' picks on for the evening without teaching the fingerprint, is not built. The games' unused `seenWith` field ('me' / 'kids' / 'both') was the same idea. |
| 2026-11-06 | **Cast without character names** | `titles.crew.cast` has no character names, so the "Why" may not say who plays whom, and the fact-check refuses texts that pair an actor with a part (*Black Panther* falls back to plain plot). TMDB credits carry `character`; storing it would let the text say "Chadwick Boseman as T'Challa". |
| 2026-11-06 | **"Why it's a match": watch the free AI budget** | The written "Why" (`src/modules/engine/why`) uses two Groq free-tier models, each 8,000 tokens a minute and about 200,000 a day: Qwen writes (~1k tokens), gpt-oss-20b fact-checks (~1k). A new text costs ~2–4k tokens and is saved per user and title for 3 days, so roughly 50–100 new "Why"s a day fit. Past that, or on a rate limit, the sheet shows the plain fact-built line. If usage grows: a paid Groq tier, or writing the text for the first few feed cards in the background. The chat's model (`MODELS.text`) is deliberately not used. |
| 2026-11-06 | **Co-watch: its "why" is AI-written from almost nothing** | Not reachable from any screen today (only `/api/recommendations/cowatch`), so no user sees it. When co-watch gets a screen: its explanations come from Mistral given only each title's name and two scores, plus one taste line per person (`src/modules/engine/cowatch/intersection.ts`), so they would invent reasons the same way the sheet's AI paragraph did (removed 2026-11-06). Build them from facts like the card (`step7-card-reason.ts`) before it ships. |
| 2026-11-05 | **The whole app's main experience: the chat (typed and voice) and the home screen** | Big one. Today the home screen is the chat, typed or by voice, with three round buttons under it: **Picks**, **Watchlist** (with a count) and **Games** (`WTWApp.tsx`; the voice chat runs on Gemini Live). Eran is considering **removing the chat altogether**, typed and above all voice, and rethinking the home screen from scratch: what goes on it, and what a user does first when they open the app. Not decided. To discuss before anything else. It touches a lot: the CLAUDE.md product rules ("conversational" onboarding and sessions), "Set Voice" in the menu, what the chat feeds today (rules like "no anime", titles you mention, the Open Questions on Taste DNA), the 48-hour check-in, which shows on the home screen, and the backlog rows that mention the chat. |
| 2026-11-05 | **Recommendations: never lose picks, never pile up (needs research)** | What happens today: the app builds a batch of up to 50 picks and the feed shows them 6 at a time. Leaving the feed (say, to the Watchlist) throws away what was loaded and where you were, so coming back shows only the first 6 again. "Find more" replaces the batch on the server, so picks from the earlier batch you never reacted to disappear (`RecommendationsView.tsx`; `/api/recommendations/generate`, 6 per page; batch size in `step3b-compose-batch.ts`). Titles you rated or saved leave on purpose. The other extreme is no better: a 187-title feed isn't useful either. Needs thinking. Claude's first idea (new batch on top, untouched picks fold into a collapsed "Earlier picks" group that expires) didn't convince Eran. **First step when picked up:** research how the best feed products handle this (fresh vs. kept, caps, grouping, what happens on return) and bring examples Eran can say "yes, this" to. Then decide, then mocks. **Rethink first (Eran, 2026-11-07): what is this list for?** Maybe its essence is to refresh itself all the time, so it never needs managing at all: nothing is removed from it, nothing stays and nothing goes anywhere, it's just an evergreen list that keeps refreshing. Keep this notion; Eran will ask to pull it out into its own item later. It also decides the Seen item's "rated cards keep their place" piece (see that row). |
| 2026-11-05 | **Watchlist: tools for a long list** | A long Watchlist is the user's choice, so give them tools to manage it: **filter** (by where to watch, e.g. Netflix or Disney+, plus the Movies / Series / Both there today), **sort**, **search inside it** (same search as the Seen page: build once, use twice), **pinned stars** ("Up next" at the top), and **select several titles to remove them or mark them seen**. Also a **compact view toggle**: a short row per title instead of the full poster card, so it holds many items without scrolling for miles. Watchlist: `RecommendationsView.tsx` in watchlist mode. |
| 2026-11-05 | **More ways to make the recommendation list better, like the "Sharper picks" card** | Eran (2026-11-05): the "Sharper picks" card in the feed is "excellent, a great start". Today it's one card between recommendations, shown to players who skipped part of the training sessions ("Finish your taste calibration so I get to know you better…" · **Finish calibration**; `CalibrateNudge` in `src/modules/session/recommendations/RecommendationsView.tsx`). Think about more cards and moves like it that make the list better as you scroll. To brainstorm together before any mock. |
| 2026-11-05 | **UI: small icons next to each menu item** | The main menu (Recommendations, Watchlist, Play, Search, My Ratings, My Taste DNA, Set Voice, Sign out) is text only. Add a small icon before each label, one style for all (outlined, same weight and size). Menu: `src/modules/session/components/AppMenu.tsx`. Pick the icons with the names that are changing: "My Ratings" becomes "Seen" and "My Taste DNA" gets a new title (see their task details). |
| 2026-11-05 | **UI: redraw the loading graphic** | The swirl under "Reading your fingerprint · Finding matches" (part fingerprint, part eye) doesn't look clean. Eran wants revisions. It's `FingerprintLoader` (`src/modules/session/components/FingerprintLoader.tsx`), shown while recommendations load, on the Ratings page and on page-to-page loading (`src/app/components/RouteLoading.tsx`), so one redraw fixes all three. Related: the eyebrow still says "fingerprint", a word Eran dropped from the "Why it's a match" sheet. Reword it in the same change. |
| 2026-11-05 | **The feed should act on people you love sooner** | Love two De Niro films and a third De Niro film gains less than one point out of 100 on its match today: a person's pull is how much you like their work × how many titles it's based on (the 15% / +8 steps), and two titles still counts as "early"; actors also weigh least of all roles (`computeCrewAffinity` in `src/modules/engine/scoring/crew-affinity.ts`; people are 32% of the match in `step2-composite-score.ts`). Decided (Eran, 2026-11-05): two loved titles with someone should noticeably lift their other work, so the feed matches what the Taste DNA page will say ("People who pull you in", which shows a person from 2 titles). |
| 2026-11-05 | **The 48-hour check-in: needs more thinking** | Eran saw it live (2026-11-05) and likes it: "it has a lot of potential, I just don't know how yet". To discuss, not to remove. What it is today: loving or liking a title from the Watchlist queues a card that shows two days later on the home screen, "48-hour check-in · Still glad you watched Zootopia?" with "Yes, glad I did" / "Wish I hadn't"; the answer nudges the title's people again and is kept as its own "regret" signal (`RegretPrompt` in `src/app/components/RegretPrompt.tsx`, shown from `WTWApp.tsx`; queue in `src/lib/regret-queue.ts`). Things to weigh: it only starts from the Watchlist (and `RecCard`'s "watched"), so most ratings never trigger it; the queue lives in that phone or browser only; and nothing yet shows the user what their answers did. |
| 2026-11-05 | **Taste DNA: make it read like a person, not a model** | **Rewritten 2026-11-09 for the v2 formula** (`docs/plan/PLAN.md`, P2-U8, owner Eran). Story traits and Mood & pace no longer drive recommendations, so they leave the page. In their place: where you lean on the 11 scales (the taste model, half of every score), genres, how much you follow the crowd, people, and your call on each genre (Never · Less of · Neutral · Like · Love, on the genre's row; no separate rules list, decided 2026-11-13). Full task: [Taste DNA — task details](#taste-dna--task-details). |
| 2026-11-05 | **Pin the Jev model** | `MODELS.jev` is `jev-latest` (`src/lib/ai-models.ts`). A floating alias can change what step 4 drops without a deploy. Once the filter has been watched on real batches for a while, pin the version Jev reports in its responses (`model` field, e.g. `jev-1.14.0`) and re-run `scripts/jev-threshold-probe.mts`. |
| 2026-11-05 | **"Why it's a match": what the Crew bar means, and put it last** | (1) The bar doesn't say what it measures. On Meet the Parents it's a short sliver with Robert De Niro listed under Crew: does that mean you only like him a little, that his part is small, or that people you love aren't in it? Today it's the average of how much you like *every* person in the title the app knows from your ratings, liked and disliked together (`crewScore` in `WhyPanel`, `src/app/components/RecCard.tsx`), so one favourite plus a few people you're lukewarm on comes out short. Decide what it should mean, then make the bar (or a few words by it) say that. (2) Most recommendations have no one you follow, so the Crew bar is often empty: move it to the **bottom** of the Score breakdown (Eran, 2026-11-05). |
| 2026-11-05 | **Two of the five "Why" bars are guesses** | Mood & pace is the overall match × 0.88, Recency is always 88%, and Narrative is the overall match itself (`WhyPanel` in `src/app/components/RecCard.tsx`). Only Crew and Reviews are real. The engine works out the real parts while scoring but doesn't pass them on; it needs to (A2), then the bars read them. |
| 2026-11-05 | **"What it's like" only shows what the engine matched on** | The lines are the title's own values, but only where the engine found something you rate highly: one genre (not all of them), the language only if you've rated others in it, tones only from the five it scores (cynical, warm, dark, comedic, hopeful). A line with no match just doesn't show. Showing every line would need the title's full details passed along with the reason (A2). |
| 2026-11-05 | **UI: a long title never moves anything else** | When two posters sit side by side, a title that wraps to two lines pushes everything below it down, so the pair stops lining up. Seen in Higher or Lower (the ★ ratings sit at different heights) and Drama Knockout (the "Haven't seen" buttons). Rule: the title area takes the same space whether the title is one line or two, so ratings, years and buttons always line up. Search the whole app for every place this happens (games, feed, Watchlist, Search) and fix them all. |
| 2026-11-05 | **Search: find a title by what you remember of it** | Describe it instead of naming it: the plot, the ending, an actor, a scene ("the one where the guy relives the same day"), and Search tries to work out what you mean and lists its best guesses. Two ways in, probably both: (1) an AI call reads the description and suggests titles, each checked against TMDB so only real ones show; (2) our catalogue already stores a plot fingerprint for each title (`titles.narrative_embedding`), so the description can be matched against those, but only for our 35k titles. Either means a 1–3s wait, so it's its own mode (a "Describe it" option), not every keystroke. Free-tier AI limits apply. |
| 2026-11-04 | **Split the card into "Want it?" and "Seen it?", plus a new Seen section** | The X moves next to Add to Watchlist (accept or reject). Loved / Liked / Disliked only rate: the button stays highlighted, the card stays where it was, and the title goes to Seen: today's **Ratings** page in the menu, reworked (updated 2026-11-05). **Slice 1 done 2026-11-06** (`feat/seen-split-card`, see `docs/INTEGRATION.md`): the two rows, the lit chip, un-rate, the X animation, no X on the Watchlist. **Left:** (2) rated cards keep their place on the next visit: on hold until the list's purpose is rethought (the "never lose picks" row); the X as a light "not for me" signal: parked (Eran, 2026-11-07); (3) the Seen page, which then says "Saved to Seen" instead of "Saved to Ratings", plus un-rating from it. Full task: [Seen — task details](#seen--task-details). |
| 2026-11-04 | **Search: adding a title teaches your taste** | Eran decided it should. The MVP only saves the card. Needs the DNA writer (A3) to take a "saved from search" signal. |
| 2026-11-04 | **Search: match % and "Why it's a match"** | The MVP card has no score. Same missing piece as the shared page's match: the engine scoring one title on request (A2), plus an AI call for the reason (a 1–3s wait, free-tier limits). |
| 2026-11-04 | **Search: "Seen it? Tell me how it was" on the card** | Left out of the MVP; small once the taste signal above exists. |
| 2026-11-04 | **Search: suggestions from the first letters, and one-word typos** | TMDB only matches whole words ("se" → junk) and needs every word spelt right. A typo in a longer name is handled since 2026-11-04 (it retries with each word left out), but a one-word typo ("shtisle", "godfahter") still finds nothing. Our 35k could do both, but `title ilike 'se%'` took 7.3s: needs a trigram index on `titles.title` (one migration). Only covers our catalogue, and Shtisel isn't in it. |
| 2026-11-04 | **Where to watch in Israel, not the US** | Search, the feed and the shared page all read the US listing (`WATCH_REGION`), so Shtisel says Chai Flicks, not Netflix, and titles outside our catalogue show nothing. Changing it touches all three. |
| 2026-11-03 | **Bigger poster in Blind Taste Test** | The cover on the reveal is too small (150px wide today). Eran wants it much bigger. |
| 2026-11-03 | **Every game poster looks the same** | A game poster is the poster, the "+" ribbon (top-right) and share (bottom-right). Nothing else. Today Blind Taste Test also has a "▶ Trailer" pill: remove it. Until further notice, trailer buttons live only on Recommendations and Watchlist cards. |
| 2026-11-03 | **Homepage share button** | The share in the homepage top bar shares the app itself ("WTW — What To Watch / Find something worth watching"). Eran wants to talk it through. Its icon changes to the forward arrow along with the share feature. |
| 2026-11-03 | **Old games-side screens nobody opens** | Still in the code, but nothing opens them anymore: the games' **"My watchlist"** (`src/app/play/components/watchlist.tsx`; the menu goes to the real watchlist), the games' **"Tonight's picks"** with its own "Why this pick?" sheet (`src/app/play/components/Picks.tsx`; "My picks" goes to the real Recommendations; found 2026-11-05), and the old **RecCard** card (`src/app/components/RecCard.tsx`; only its `WhyPanel` is used). Remove them, or confirm they're still needed. The old `.whyOverlay`/`.hero*` styles in `RecommendationsView.module.css` go with Picks. |
| 2026-11-03 | **Your match % on a shared title's page** | The friend's page (`/t/…`) could show a signed-in friend their own match, as mocked in `docs/prototypes/share/v3/8b`. Needs the engine to score one title on request (A2). |
| 2026-11-03 | **Share in Six Degrees** | Its film rows are too small for a share button away from the "+"; left out of the share build. |

---

## Task details

Longer write-ups for rows that need more than a line. Each one is linked from its row above.

### Seen — task details

*Added 2026-11-04 · Status: not started · Mock first, then build*

**Summary**
Each card today mixes two different questions in one row, and the X sits in the wrong one. Split them:
- **"Want it?":** accept or reject the recommendation. **Add to Watchlist** (large, primary, orange) and a small **X** beside it.
- **"Seen it?":** rate it. Loved / Liked / Disliked. This only teaches the app your taste and adds the title to **Seen**. It never removes the card.

**Seen** isn't a new section: it's today's **Ratings** page in the main menu, reworked (Eran, 2026-11-05). It holds every title you've rated, from anywhere in the app: Recommendations, the Watchlist, Search, the games and the training sessions.

**Why**
Today, rating a recommendation turns the card into a grey message ("Loved — weighted strongly into your taste") with no buttons. The X disappears with it, so the card can't be changed or removed, and on the next visit it's quietly gone.
The X also means two things at once. Disliked means "I watched it and didn't like it". The X means "I don't want to watch it". Those are different answers, and now each gets its own place.
**Rule:** only the X, **Add to Watchlist** (on Recommendations: the title moves to the Watchlist, updated 2026-11-06) or "Remove from Watchlist" takes a title off a list. A rating never does.

**What the user sees: Recommendations**
1. **"Want it?" level:** Add to Watchlist (large, primary) with the X beside it (small, secondary).
2. **"Seen it?" level:** "Seen it? Tell me how it was" and Loved / Liked / Disliked, with no X in this row.
3. **Tapping a reaction:** that button switches to a pressed, highlighted state (light animation). The prompt line changes to a short note, draft copy **"Saved to Seen"**. The card stays exactly where it is.
4. **Changing your mind:** tap a different reaction and the highlight moves to it, updating the rating.
5. **Tapping the X**, rated or not: the card leaves the list (light animation) and is never recommended again. If it was rated, it stays in Seen.
6. **Coming back later:** a rated card you didn't X is still in the list, **in the same position** (if it was 3rd, it's still 3rd). New titles fill in around it.

**What the user sees: Watchlist**
- Same card design, except the "Seen it?" row has **no X**. The large "Remove from Watchlist" button already covers removing.
- Rating only adds the title to Seen and highlights the button. The card stays on the Watchlist until you remove it.
- Loved and Liked still queue the 48-hour "glad / neutral / regret" check-in, as they do today.

**What the user sees: everywhere else**
- **Games and training sessions:** the poster is part of the screen there, so nothing moves or leaves. A rating just adds the title to Seen.
- **Search:** once search cards get the Seen-it chips (its own backlog row, from the Search PR), those ratings go to Seen too.

**What the user sees: the Seen page (today's Ratings page)**
Today the Ratings page shows a count, four tiles (Loved / Liked / Disliked / Removed), and a list of bare titles you tap to open, over a dimmed random poster. Reworked:
- **Only rated titles:** Loved, Liked and Disliked. **No Removed**: X'd titles aren't "seen", so they don't show here.
- **Filter with the same buttons as the "Seen it?" row** (Loved / Liked / Disliked, same look). None selected = show everything. Tap one = show only those.
- **Each title shows its poster** plus a few details (for example year, movie or series, length). The exact format is still to be brainstormed: see the open questions.
- **Change a reaction** right there, the same way as on the card.
- **Search inside the page** when there are many titles.
- **Refine the two dropdowns** above the list. The type dropdown (today All / Movies / Series) says **Both** instead of "All", matching the feed's Movies / Series / Both. The sort dropdown (today "Date Added" / "Oldest First" / "Title A–Z") gets clearer labels too: "Date Added" doesn't say whether it's newest or oldest first.

**Rules**
- Nothing you've rated or X'd is ever *suggested again* in a new batch.
- A rated card that's already on your list stays there, in its place, until you X it.
- The X counts as a light "not for me" signal, much weaker than Disliked. Today it only hides the title.
- Rating a title and also adding it to the Watchlist is allowed (rewatching is real): it's in Seen *and* on the Watchlist.
- The Watchlist isn't automatically cleared of seen titles. A rated title stays until you remove it.

**Open questions**
- **The copy:** "Saved to Seen" is a draft. Same line for all three reactions, or slightly different for Disliked?
- **Un-rating:** does tapping the highlighted button again clear the rating?
- **Removing from Seen:** can you remove a title from Seen, and if so, does that forget the rating entirely, so your taste updates as if you never rated it?
- **Name:** keep "Ratings" in the menu, or rename it "Seen" to match the "Saved to Seen" note on the card? (Claude leans "Seen".)
- **Display format (to brainstorm):** list rows with a small poster, or a poster grid? Which details: year, movie or series, length, the date you rated it?
- **Action buttons:** are the three reaction buttons always visible on each title, or only after a tap (as today)? Anything else to do from here, like Add to Watchlist or share?
- **Filters:** can you select more than one at a time (Loved + Liked)? Keep today's sort (date added, title)?
- **Search:** from how many titles does the search box appear, or is it always there?
- **Restoring X'd titles:** today the Removed tile has a Restore button that lets a title be recommended again. With Removed gone from this page, where does Restore live, or is it dropped?
- **Old ratings:** does Seen start with everything already rated before it exists? (Likely yes, if the data allows it.)
- **Empty state:** what Seen says before you've rated anything.

**Build notes (for whoever picks it up)**
- **Keeping a rated card in place:** today every rating changes the taste profile, which rebuilds the list, and the rebuild drops anything rated (the generate route filters out every rated title, and step 1 of the engine never picks them). Keep a per-user list of "rated, still on the feed" titles with their position, and put them back at that position when serving. New batches still never pick rated titles. The X clears the title from that list and adds it to the removed list.
- **X as a signal:** today the X only writes to the removed list. Add a light negative taste signal: an engine change, so agree it with the engine owner.
- **Changing a reaction** must **update** the existing rating, not add a second one. Check how the feedback route handles that today.
- **Seen data:** the Ratings page already reads your ratings (`RatingsView` in `src/modules/session/ratings/RatingsView.tsx`, from `GET /api/recommendations/ratings`) and can change a reaction. Check it includes ratings from the games, the training sessions and Search, and that it can return posters.
- **Areas touched:** the card and the Recommendations / Watchlist screen, the main menu, how the recommendations list is served, the Ratings page, and the games and training sessions (only to add to Seen, with no change on screen).
- **Process:** one JPEG mock per state before building: the new card with both levels, the card after rating (pressed button and new copy), the card leaving on X, the Watchlist card, the Seen page (no filter, one filter, searching), Seen when empty, and the menu with Seen in it.

**Done when**
- The card has two clear levels: Add to Watchlist + X, then "Seen it?" with no X.
- Rating highlights the button, changes the prompt line, adds the title to Seen, and leaves the card in place, also after coming back later.
- The X removes the card for good and counts as a light "not for me".
- On the Watchlist, rating only adds to Seen. Only "Remove from Watchlist" removes.
- The Ratings page becomes Seen: only rated titles, each with its poster and reaction, filtered with the "Seen it?" buttons, searchable, and the reaction can be changed there.
- Nothing leaves Recommendations or the Watchlist except by the X, Add to Watchlist (Recommendations only) or "Remove from Watchlist".

### One open conversation per user — a unique index
Two concurrent first loads (`/` plus a prefetched `/play`, or two tabs) can each insert an open conversation; the older code had the same race. A partial unique index closes it: `create unique index on conversations (user_id) where ended_at is null`, with the insert in `createConversationNumbered` handling the conflict by re-reading. Not a regression of 2026-11-05's `home_bootstrap()` (PR #198 review); do it when a duplicate is actually seen.

### Taste DNA — task details

*Added 2026-11-05 · **Rewritten 2026-11-09 for the v2 formula** · **Genres and rules redesigned 2026-11-13** · Owner: Eran (`docs/plan/PLAN.md`, P2-U8) · Page: `src/app/profile/dna/page.tsx` (rules: `RulesSection.tsx`, header: `DnaHeader.tsx`) · Mocks: `docs/prototypes/taste-dna-v2/` (2026-11-13, real data; `build.py`, the data file stays outside the repo). The 2026-11-07 mocks (`docs/prototypes/taste-dna/`) are pre-v2.*

**Decided 2026-11-13 (Eran, from the v2 mocks): rules live on the genre rows**
- **There is no Rules section.** A rule is your call on a genre, so each genre row carries it. One place per genre, so two rules can't sit on one genre and the page can't contradict itself.
- **Each of the 16 genres has one call, five steps from less to more: Never · Less of · Neutral · Like · Love.** Neutral is the genre screen's blank. The page and the genre screen are one control over the same answers.
- **What each does:** Never hides it (rule, exact 16, DEC-6). Less of = score × 0.7, holds until changed. Love / Like = the DEC-13 starting lean (#278), which **fades** as you rate. Guards hold; hints get taken over by what you do.
- **"More of" is not a word on the page.** Love / Like is the "more of", and it needs no `dna.ts` change.
- **Genre rows show what your ratings say** ("Mixed · 12 titles"), on the 16 genres, **not the model's genre weight**: the model has 13 genre inputs, so it can't tell Sci-fi, Fantasy and Superheroes apart. Alon, measured 2026-11-13: Sci-fi 28 rated, none disliked; Superheroes 21 rated, 14 disliked. The 16 settle the Alon question for the page.
- **Stretch pick results leave the page:** in v2 accepting or rejecting one changes nothing in the feed (only its rating counts).

**Context: why this was rewritten (read first)**
- **The team approved the v2 formula on 2026-11-09:**
  - Every recommendation score = creators 30% + crowd 20% + taste model 50%.
  - Story match, mood & pace, and genre habits now weigh **zero**.
  - Evidence: `docs/plan/EVIDENCE.md`. All three scored at or below a coin flip for us.
- **The taste model is a small per-person model.** It reads every rated title's 11 scales, its genres and its crowd rating, plus every this-or-that pick, and works out how much each one moves *you*.
  - 10 of the 11 scales are the season's: serious–funny, talk–action, slow burn–fast, light–dark, easy watch–puzzle, real world–other worlds, classic–recent, blockbuster–off-beat, silly–dry wit (comedies only), mini-series–long haul (series only). The 11th, new since T2 (2026-11-09), is **for kids–for adults**. See `src/app/play/lib/scales.ts`.
  - The model is retrained on every rating, and nothing is stored. Code: `src/modules/dna/taste-model.ts` (P1-D4, being built).
- **What this means for the page:**
  - The page should answer "what does the app think I like?". After v2, the honest answer is **the people, the scales, the genres and how much you follow the crowd**.
  - **Story traits** (strand B, "Narrative Dimensions") and **Mood & pace** (strand C, "Visceral Specs") still exist in the DNA, but they no longer touch a single recommendation. Showing them would describe things that don't drive the feed. **They leave the page.**
  - The decided items about them are cancelled: old items 1, 6 and 7, and the build note about greying moods, which needed a change to `src/types/dna.ts`.

**Order, top to bottom (new)**
1. Header and the "In short" sentence
2. How you like it (the scales)
3. Genres, with your call on each (this is where rules live now)
4. You and the crowd
5. People who pull you in

Page title: still along the lines of "My taste" (old item 9). Settle the exact words at mock time.

**1. Header (new)**
- **The meta line:** "46 ratings · 12 picks · updated 3 Nov" (the longer "Based on…" ran under the back and menu buttons in the mocks), replacing "22 signals · v4 · 11/3/2026". The footer "Schema v1 · N sessions" goes.
- **The summary sentence** at the top (today an AI text from the people and story traits, `src/app/api/dna/summary/route.ts`, cached per `taste_version`) is rebuilt from the v2 facts: the 2 strongest scale leanings, the strongest genre, the crowd line and the strongest person.
  - Example, from Eran's real data: "You go for light, down-to-earth stories, you usually agree with the crowd, and anything Christopher Nolan makes."
  - Same rules as "Why it's a match": facts only, fact-checked, and a plain fact-built sentence if the AI is down.

**2. How you like it — the 11 scales (new; replaces Story traits and Mood & pace)**
- **What it shows:** one row per scale. The left label, a track, the right label. A dot marks where you lean.
  - This is the **same component and look as the season's scale rows**: `AxisRow` in `src/app/play/components/ui.tsx` (dot at `50% + lean × 46%`, the dot's opacity = how sure, and a `lean-l` / `lean-r` class when the lean is clear).
  - The page and the season then speak one language, which was a reason for picking option A in the deck.
- **The data:** the taste model's weight on each scale input (`trainTasteModel` → `w[14..24]`; `w[24]` is the kids ↔ adults scale).
  - Lean = weight ÷ 0.4, clamped to −1..1. The 0.4 is a starting point: the strongest scale weights we measured were 0.3–0.5.
  - "How sure" = how many of your rated titles or picks sit clearly at one end of that scale (|value| ≥ 0.5): 0 → grey, 8+ → full.
- **Sorted strongest lean first.** Scales with no clear lean go to the bottom, greyed, with no words.
  - Silly–dry wit shows only if you've rated 5+ comedies; mini-series–long haul only if you've rated 5+ series.
- **No numbers, no percentages, no legend.**
- **What it would say today:**
  - **Eran:** light (not dark) · real world (not other worlds) · off-beat (not blockbuster).
  - **Shahar:** dry wit · other worlds · classic.
  - **Alon:** classic (not recent) · mini-series (not long haul).
- **A known issue to settle before mocks: Alon.**
  - Alon is a huge sci-fi and fantasy fan, yet the model reads him as leaning away from sci-fi, and the page would say so.
  - **Cause, measured 2026-11-09:** he has rated 77 sci-fi/fantasy titles, and 23 are dislikes. 15 of those are Marvel or DC superhero films, and the game genres file superheroes under sci-fi. He loved Star Wars, Blade Runner, Alien and Interstellar.
  - **There is a second, deeper effect.** A fan watches everything in his genre, the mediocre ones too, so his *average* there drops, while the model ignores how much of his watching that genre is.
  - **One fix was tested:** a "superhero" input lifts Alon's own score from 76.6 to 78.2 and changes nothing for Eran and Shahar. His sci-fi lean is still negative with it, so it is only part of the answer.
  - It belongs to the "fingerprint from hits" discussion (PLAN.md, open topics).
  - **Settled for the page on 2026-11-13:** genres are shown on the 16 from your ratings, so Alon's page reads "Sci-fi: enjoyed all 28 · Superheroes: mostly disliked". The model's own 13 genre inputs still lump them (a later note for Shahar).

**3. Genres, with your call on each (redesigned 2026-11-13; replaces old item 10 and the Rules section)**
- **The 16 genres** (`GENRES_16`, `src/app/play/lib/genres16.ts`), in the genre screen's order, with its icons, colours and wash (`GenreStep.tsx` `LOOK`, `onboarding.css`). A row with a call lights up exactly as on the genre screen.
- **Each row, two things:**
  - **Left, under the name: what your ratings say**, in words, from your loved / liked / disliked titles in that genre (`genres16Of` on each rated title): "Loved all 7" · "Enjoyed all 28" (none disliked) · "Mostly enjoyed · 9 titles" (≤ ¼ disliked) · "Mostly disliked · 21 titles" (≥ 60%) · "Mixed · 12 titles" · "Only 2 rated so far" (under 3) · "Nothing rated yet" · a Never with nothing rated: "Hidden from your feed".
  - **Right: your call** as the genre screen's own icon on its grey tile: pink heart = Love, green thumb = Like, red ban = Never, double chevron = Less of. Neutral = no tile.
- **Above the rows:** "Tap a genre to get more or less of it." and the genre screen's own line, "We'll never show you Horror, Anime."
- **Tapping a row opens a sheet** (the person sheet's look): the genre's icon and name, the words line, then "How much of it do you want?" with the five choices in a row (Never · Less of · Neutral · Like · Love), one line saying what the chosen one does (it changes as you tap), then **What you rated**: the titles with your marks, newest first.
  - The lines: Love "Your feed leans towards Action from the start. As you rate more, your ratings take over." · Like "Your feed leans a little towards Action. …" · Neutral "No lean either way: your ratings alone decide." · Less of "You'll still see Action, just lower down your feed. Stays until you change it." · Never "We'll never show you Action."
- **Where the answers live:** one store for the page and the genre screen (the 16 answers the genre screen saves), so #278's lean reads page edits too. Never also writes its `genre16Rule()`; Less of a soft preference (`weight_modifier: 0.7`) on that genre16. Every change bumps `taste_version`, so the feed rebuilds.

**4. You and the crowd (new, its own small card under Genres; mocked 2026-11-13)**
- **The data:** the taste model's crowd-rating weight (`w[0]`).
- **The words:**
  - ≥ 0.30: "You tend to love what everybody loves."
  - 0.10–0.30: "Sometimes you're with the crowd, sometimes not."
  - < 0.10: "You don't go by popularity: plenty of crowd favourites leave you cold."
- **Today:** Eran 0.38 / Alon 0.18 / Shahar 0.09 — one of each.
- **Settle at mock time:** where it sits, and the exact words. The "Why" sheet's rule against talking about critics doesn't apply here: this line is about you, not about a title.

**5. People who pull you in (unchanged from old item 5; still drives 30% of every score). Later, rules about people use the same sheet as genres.**
- **Title:** "People who pull you in" (working title), not "Creative Affinities".
- **Who:** directors, actors, and writers who wrote the script (not the author of the book it's based on; already how writers are collected in `src/lib/tmdb.ts`). **No cinematographers** on the page, though the engine still counts them.
- **The bar = how much you like their work**, not how many titles: everything "loved" = a full bar, everything "liked" = half, a mix in between. No number.
- **Under the name:** "from 3 titles"; tap to see those titles with your marks. This replaces "Confidence" and the percentages.
- **A person shows only after 2 rated titles with them.** Before that, at most one quiet line: "Spotted in what you loved: Pacino, Michael Mann".
- **Top 5 per group**, strongest first, then "See all".
- **Empty state:** "Rate a few titles you've seen and we'll spot the directors and actors you keep coming back to."
- **Related backlog rows:** "The feed should act on people you love sooner"; dislikes no longer move people (done).

**6. Rules: folded into Genres (2026-11-13)**
- No Rules section, no dropdowns: the genre sheet is the rule picker (it covers P1-C3's spec: Never / Less of + a genre from a closed list, no typing, one rule per genre).
- **Rules typed before v2** were removed by P1-C1. If a fingerprint still holds a rule that isn't one of the 16 genres, show it in a quiet "Older rules" line with a remove button; nothing new can be made there.
- **People rules** come later, on the person sheet, same five choices.

**7. Removed from the page**
- **Story traits** ("Narrative Dimensions"): not used by v2.
- **Mood & pace** ("Visceral Specs"): not used by v2.
- **"Confidence" bars and percentages, everywhere.**
- **Open Questions:** filled only by the chat, which no longer writes anything (PLAN DEC-5). The section can't fill any more; remove it.
- **Stretch Pick Results** (decided 2026-11-13): accepting or rejecting a stretch pick writes only to story traits (`update-from-stretch.ts`), which weigh zero in v2, so it changes nothing in the feed. Stretch picks themselves stay (1 in 20, from 15 ratings).

**Build notes (for whoever builds it)**
- **No DNA contract change is needed.** "More of" is Love / Like (DEC-13).
- **A new read-only route, `GET /api/dna/taste`** (A3), returns `{ scales: [{ id, lean, sure }], genres: [{ id, loved, liked, disliked, call }], crowd, ratings, picks, updated_at }` (genres on the 16; `call` = never / less / like / love / null).
  - It's built from `loadTasteTraining` + `trainTasteModel` (P1-D4), cached per `taste_version`.
  - It needs P1-D4 merged. Until the scales cover every title (P1-D2), it reads only rated titles among the 980 that have them, so mocks can use real data now.
- **Reuse `AxisRow` from the season as is** (the "own the pixels" rule). If the page needs a variant, change the shared component, not a copy.
- **Mocks** (`docs/prototypes/taste-dna-v2/`, 2026-11-13): the page right after onboarding (top, genres, bottom), a genre tapped, Alon's genres, Alon setting Less of on Superheroes, and a user with very little data. The person sheet is unchanged from `docs/prototypes/taste-dna/3-name-tapped`.

**Done when**
- The page shows only what drives recommendations: scales, genres with your calls, crowd and people.
- No percentages or "Confidence" labels anywhere.
- The scales look exactly like the season's; the genre rows exactly like the genre screen's.
- A genre's call is set from its sheet: Never · Less of · Neutral · Like · Love. No typing, one call per genre, and the genre screen shows the same answers.
- Story traits, Mood & pace, Open Questions, Stretch pick results and the Rules section are gone.

**Parked: rethinking rules** (Eran, 2026-11-05, back burner)
- ~~**Rules on the items themselves**~~ **Adopted for genres on 2026-11-13** (section 3); people follow later.
- **A "Tune" mode with draggable dots** on the scales: drag where you want to be. A dragged dot stays and is marked as yours, with a reset. Knobs appear only in Tune mode, so the page never looks like a form (the no-forms rule). In v2 a dragged scale would set an override on the taste model's weight. That isn't designed yet.
- ~~**The rules list then shrinks**~~ Done: there is no rules list.
