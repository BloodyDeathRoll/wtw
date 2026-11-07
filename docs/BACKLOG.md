# Backlog

Things we've decided to come back to. Newest first. When one gets picked up, move it to `docs/INTEGRATION.md`; when it ships, delete it here.

| Added | Item | Notes |
|---|---|---|
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
| 2026-11-05 | **Taste DNA: make it read like a person, not a model** | Discussed 2026-11-05; next: mocks. "Confidence" percentages mean nothing to a user ("23% De Niro, 15% Matt Damon"?). Mood & pace keeps its bars (no numbers), people become "People who pull you in", story traits become plain sentences, and "Add a rule" picks a genre from a list instead of typing. The bigger rules rethink is parked. Full task: [Taste DNA — task details](#taste-dna--task-details). |
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
**Rule:** only the X (or "Remove from Watchlist") takes a title off a list. A rating never does.

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
- Nothing leaves Recommendations or the Watchlist except by the X or "Remove from Watchlist".

### One open conversation per user — a unique index
Two concurrent first loads (`/` plus a prefetched `/play`, or two tabs) can each insert an open conversation; the older code had the same race. A partial unique index closes it: `create unique index on conversations (user_id) where ended_at is null`, with the insert in `createConversationNumbered` handling the conflict by re-reading. Not a regression of 2026-11-05's `home_bootstrap()` (PR #198 review); do it when a duplicate is actually seen.

### Taste DNA — task details

*Added 2026-11-05 · Status: needs a discussion, then mocks · Page: `src/app/profile/dna/page.tsx` (rules: `RulesSection.tsx`)*

**Summary**
The Taste DNA page is a good idea, but it shows the app's inner workings, not something a person can relate to. It should answer "what does the app think I like?" in plain words. What the user sees matters here, not how the app works it out.

**What's wrong today**
- **"Confidence" means nothing to a user.** Under each director, writer and actor, and under each story trait, there's a "Confidence" bar and a percentage. It's how sure the app is, but it reads as how much you like them: is the app 23% sure about De Niro and only 15% about Matt Damon? "It's 16% sure my Moral Ambiguity is Medium": what does that mean, in English?
- **The story traits are jargon:** "Moral ambiguity: Medium", "Ensemble vs solo: Slight ensemble", "Originality: 61 / 100".
- **Mood & pace works** (today "Visceral Specs": pacing and tone). It's a display a regular person can relate to, but the numbers ("65", "Weight · 50 = neutral") aren't needed. The length of the bar is enough, as in the "Why it's a match" sheet.

**Decided (Eran, 2026-11-05)**
1. **Mood & pace** replaces "Visceral Specs", the same name as in the "Why it's a match" sheet. Bars only: no numbers and no "Weight · 50 = neutral" legend.
2. **The people section** ("Creative Affinities": directors, writers, actors) moves **below** Mood & pace.
3. **Drop "Confidence" as it's shown today** (the label and the percentages) in favour of something a user understands. See the ideas below.
4. **Rules, for now** (Eran, 2026-11-05). The bigger rethink is parked (see "Parked" below). For now, a small fix to "Add a rule":
   - **The typing box goes.** A second dropdown next to the first one picks from a closed list: **genres** to start (the same list as the training sessions' opening genre screen). More kinds of things may be added later.
   - **The first dropdown covers every intention:** Never show me · Less of · More of.
   - **A genre that already has a rule can't be picked again** (greyed out in the list), so "Never horror" and "More of horror" can never sit side by side. To change one, remove the old rule first.
   - **Why:** typing saves typos and gibberish that silently do nothing. Eran's own page has "dokumenrty" and "roses and beads · 50% Less". Rules already typed stay listed, with their x.
5. **The people section, redesigned.** It says one thing: "when these people make something, you'll want to watch it."
   - **Title:** "People who pull you in" (working title), not "Creative Affinities".
   - **Who:** directors and actors. Writers too, but only people who wrote the script (Aaron Sorkin is a "watch it" on his own); not the author of the book it's based on (that's already how writers are collected: `src/lib/tmdb.ts`). **No cinematographers** on the page. Writers are in (Eran, 2026-11-05): "wrote the script", not "original", or Sorkin would drop out of *The Social Network* and *Moneyball*, both based on books.
   - **The bar = how much you like their work,** not how many titles: everything of theirs you rated "loved" = a full bar, everything "liked" = half, a mix lands in between. De Niro full ("I'll love it"), Pacino half ("I'll enjoy it"). No number on it.
   - **Under the name,** a small grey line: "from 3 titles". Tap the name to see those titles, each with your loved / liked mark. This replaces the confidence bar and %, and means we never need one word for "loved or liked".
   - **It waits until it's learned:** a person shows only once **2 titles** with them are rated. One loved film brings in about seven people at once (director, writers, top 3 actors…), and showing all of them as "you love their work" would be false. Before that, at most one quiet line: "Spotted in what you loved: Pacino, Michael Mann".
   - **No 59 names:** the 2-title bar already cuts most of them. Then the top 5 per group, strongest first (how much you like them, then how many titles), and a "See all" link for the rest.
   - **Empty state:** "Rate a few titles you've seen and we'll spot the directors and actors you keep coming back to."
   - Related rows: dislikes no longer move people; the feed should act on a person sooner (both in the table above).
6. **Story traits** (Eran accepted, 2026-11-05): each trait is its plain-English sentence ("You like main characters who are flawed, and know it"), not "Moral ambiguity: Medium". The app already writes one per trait (`notes`), once it has enough to go on. No percentages. Traits it's still unsure about go in one quiet line at the end: "Still figuring out: humour, moral grey areas".
7. **Mood & pace bars** (Eran, 2026-11-05):
   - **Plain bars from zero, no middle line, no numbers.** A short "Dark" bar reads "you like it a little dark", a long "Comedic" bar "you like it funny". That's fine.
   - **Each group (Pace, Tone) sorted longest bar first.**
   - **Moods the app knows nothing about yet are greyed out, at the bottom of their group.** No words: colour for what it knows, grey for what it doesn't. The page should feel visual, not wordy.
   - **A whole group with nothing known is hidden** (e.g. the craft aspects, which only fill in from the deep surveys) rather than a stack of grey bars.
   - **Build note: the app can't tell "unknown" today.** Mood & pace is stored as one number per mood, with no count of how many rated titles carried it, and every rating re-balances the whole group around the middle (`recenterWeights` in `src/modules/dna/lib/update-strand-c.ts`), so a mood you never touched still drifts off 50. Greying needs a small addition: a count per mood, the way genres already keep one (`sample_size`). That's a change to the shared DNA contract (`src/types/dna.ts`). The re-balancing also means the bars are relative within a group ("funny more than dark"), which suits plain bars.

8. **Order** (Eran, 2026-11-05): Story traits, Mood & pace, People who pull you in, Rules.
9. **Page title** (Eran, 2026-11-05): personal, along the lines of "My profile" or "My DNA", not "Taste DNA". Claude suggests **"My taste"**. Settle the exact words at mock time.

**Parked: rethinking rules** (Eran, 2026-11-05: back burner, not part of this task)
Ideas from the discussion, so they aren't lost:
- **Rules on the items themselves** instead of a free list. Eran's doubt: how would a user know that tapping a name means rules? Answer offered: a chevron (›) on each row opens a sheet about that person or mood (evidence first, then More of / Less of / Never), the way a contact's page has "Block" at the bottom.
- **"Tune" mode with draggable bars.** Eran's point: "you like it a little dark" next to a "More of" button is a contradiction; dragging the bar to where you want it is more honest. Conditions: a bar you dragged stays put and is marked as yours (with a reset); knobs appear only in a "Tune" mode per section so the page never looks like a form (no-forms rule); moods have no "Never" (dragging to empty = as little as possible); people get a ⊘ for "Never" in Tune mode; story traits are sentences, nothing to drag.
- **Genres as their own section**, shown as the same Love / Like / Never chips as the training sessions' opening screen. That's where genre rules come from today: "Never" there is saved as a rule (since 2026-10-21), the chat saves rules since 2026-08-29.
- **The rules list then shrinks** to things not on the page (a person you've never rated), added by picking, never typing.

**Ideas for the discussion (Claude's, not decided)**
- **Same words as the "Why it's a match" sheet:** Crew, Narrative, Mood & pace. The page and the sheet then talk about your taste in the same terms.
- **The header** "22 signals · v4 · 11/3/2026" becomes something like "Based on 22 ratings · updated 3 Nov". The footer "Schema v1 · N sessions" goes.

**Open questions**
- **Open Questions and Stretch Pick Results** (the two sections at the bottom): Eran has never seen them, because they only show once something is in them. Open Questions fill only from chat sessions (the AI notes what to ask next time); Stretch Pick Results only once you've reacted to a deliberate "outside your comfort zone" pick, which starts after 15 ratings. Leave them as they are for now and decide when the chat and stretch picks get their own look.

**Build notes (for whoever picks it up)**
- **"More of" needs a change to the shared DNA contract** (`src/types/dna.ts`): a "Less of" rule is stored with a strength between 0 and 1, which can only lower a score. Tell all three before changing it, and check the engine applies a boost.
- **Rules about people** can only be added by naming them in a session today; the "Add a rule" box takes genres and keywords. Rules about story or mood & pace don't exist yet.
- **Process:** discussion first, then one JPEG mock per state: the full page, a new user with little data, the people section with a name tapped, and "Add a rule" with the genre dropdown (a genre that already has a rule greyed out).

**Done when**
- No percentages or "Confidence" labels a user has to decode.
- Mood & pace shows bars only, and the people section sits below it.
- Every trait reads as plain English.
- "Add a rule" picks Never / Less of / More of and a genre from a list; no typing, and no two rules on the same genre.
