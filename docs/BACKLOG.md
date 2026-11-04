# Backlog

Things we've decided to come back to. Newest first. When one gets picked up, move it to `docs/INTEGRATION.md`; when it ships, delete it here.

| Added | Item | Notes |
|---|---|---|
| 2026-11-04 | **Strip "Why it's a match" down to the why** | Title, a little metadata, the reason, simple bars, plain "Label: value" lines and the names that matter to you. Nothing else: no buttons, no match ring, no weights or numbers, no blurred poster. Full task: [Why it's a match — task details](#why-its-a-match--task-details). |
| 2026-11-04 | **Split the card into "Want it?" and "Seen it?", plus a new Seen section** | The X moves next to Add to Watchlist (accept or reject). Loved / Liked / Disliked only rate: the button stays highlighted, the card stays where it was, and the title goes to Seen, a new main section next to Recommendations, Watchlist, Play and Search. Full task: [Seen — task details](#seen--task-details). |
| 2026-11-04 | **Search: adding a title teaches your taste** | Eran decided it should. The MVP only saves the card. Needs the DNA writer (A3) to take a "saved from search" signal. |
| 2026-11-04 | **Search: match % and "Why it's a match"** | The MVP card has no score. Same missing piece as the shared page's match: the engine scoring one title on request (A2), plus an AI call for the reason (a 1–3s wait, free-tier limits). |
| 2026-11-04 | **Search: "Seen it? Tell me how it was" on the card** | Left out of the MVP; small once the taste signal above exists. |
| 2026-11-04 | **Search: suggestions from the first letters, and one-word typos** | TMDB only matches whole words ("se" → junk) and needs every word spelt right. A typo in a longer name is handled since 2026-11-04 (it retries with each word left out), but a one-word typo ("shtisle", "godfahter") still finds nothing. Our 35k could do both, but `title ilike 'se%'` took 7.3s: needs a trigram index on `titles.title` (one migration). Only covers our catalogue, and Shtisel isn't in it. |
| 2026-11-04 | **Where to watch in Israel, not the US** | Search, the feed and the shared page all read the US listing (`WATCH_REGION`), so Shtisel says Chai Flicks, not Netflix, and titles outside our catalogue show nothing. Changing it touches all three. |
| 2026-11-03 | **Bigger poster in Blind Taste Test** | The cover on the reveal is too small (150px wide today). Eran wants it much bigger. |
| 2026-11-03 | **Every game poster looks the same** | A game poster is the poster, the "+" ribbon (top-right) and share (bottom-right). Nothing else. Today Blind Taste Test also has a "▶ Trailer" pill: remove it. Until further notice, trailer buttons live only on Recommendations and Watchlist cards. |
| 2026-11-03 | **Homepage share button** | The share in the homepage top bar shares the app itself ("WTW — What To Watch / Find something worth watching"). Eran wants to talk it through. Its icon changes to the forward arrow along with the share feature. |
| 2026-11-03 | **Old games-side "My watchlist" screen** | `src/app/play/components/watchlist.tsx` is still in the code, but nothing opens it anymore: the menu goes to the real watchlist (the feed-style page). Remove it, or confirm it's still needed. |
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

**Seen** is a new main section in the menu, next to Recommendations, Watchlist, Play and Search. It holds every title you've rated, from anywhere in the app: Recommendations, the Watchlist, Search, the games and the training sessions.

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
- **The Seen page:** same card look as the Watchlist. Each card shows your reaction as a pressed button. Tap a different reaction to change it.

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
- **Filters on Seen:** pills like WhatsApp's (All / Loved / Liked / Disliked)? Sort newest first?
- **Old ratings:** does Seen start with everything already rated before it exists? (Likely yes, if the data allows it.)
- **Empty state:** what Seen says before you've rated anything.

**Build notes (for whoever picks it up)**
- **Keeping a rated card in place:** today every rating changes the taste profile, which rebuilds the list, and the rebuild drops anything rated (the generate route filters out every rated title, and step 1 of the engine never picks them). Keep a per-user list of "rated, still on the feed" titles with their position, and put them back at that position when serving. New batches still never pick rated titles. The X clears the title from that list and adds it to the removed list.
- **X as a signal:** today the X only writes to the removed list. Add a light negative taste signal: an engine change, so agree it with the engine owner.
- **Changing a reaction** must **update** the existing rating, not add a second one. Check how the feedback route handles that today.
- **Seen data:** ratings are already stored as taste signals, so Seen can probably be built from them. Check that they can be read back as a list with posters.
- **Areas touched:** the card and the Recommendations / Watchlist screen, the main menu, how the recommendations list is served, a new page under `src/app` (shared, so coordinate first), and the games and training sessions (only to add to Seen, with no change on screen).
- **Process:** one JPEG mock per state before building: the new card with both levels, the card after rating (pressed button and new copy), the card leaving on X, the Watchlist card, the Seen page, Seen when empty, and the menu with Seen in it.

**Done when**
- The card has two clear levels: Add to Watchlist + X, then "Seen it?" with no X.
- Rating highlights the button, changes the prompt line, adds the title to Seen, and leaves the card in place, also after coming back later.
- The X removes the card for good and counts as a light "not for me".
- On the Watchlist, rating only adds to Seen. Only "Remove from Watchlist" removes.
- Seen is in the main menu, lists every rated title with its reaction, and the reaction can be changed there.
- Nothing leaves Recommendations or the Watchlist except by the X or "Remove from Watchlist".

### Why it's a match — task details

*Added 2026-11-04 · Status: not started · Mock first, then build*

**Where it opens (checked in the code)**
Only from a card on Recommendations or the Watchlist (the same screen in both). It always opens on top of the title you're looking at, never on its own: it has no address of its own and nothing links to it. Search cards don't have it, and neither does the shared-title page. The games have their own, smaller "Why this pick?" panel, which also uses the "FINGERPRINT" label (see the open questions).

**Summary**
You're already looking at the title. The only question this screen answers is "why did you think I'd like it?". Everything else goes.

**What it shows**
1. **Title**, plus a little metadata (year · length · ★ rating).
2. **Why:** the written reason, as it is today, under a plain heading like "Why". No "FINGERPRINT" label.
3. **Score breakdown:** the bars only. No weights (no "Crew 35%", no "Recency 5%") and no numbers on the right (no "85"). The bar says it. Labels:
   - **Crew**, **Narrative** and **Recency** stay as they are.
   - Visceral → **Mood & pace** (how it feels: its tone and speed).
   - Ratings → **Reviews** (what critics and audiences think).
4. **The story side:** one line per item, **"Label: value"**, showing the title's own value. For example, "Pacing: moderate", "Tone: warm, hopeful", "Genre: drama", "Language: English" (the full name, not "en"). No "drama → drama" arrows. **Drop "Format"** (movie or TV is obvious). Lay it out so label and value are easy to tell apart.
5. **Crew:** the heading is just "Crew" (not "Crew in your fingerprint"). Only names: the people in it or behind it that the app has learned you particularly like and follow, each with their role in small grey text (Actor, Director, Writer). No percentage bars ("15% of Matt Damon").
6. **When there's no crew match:** no "No crew members from your watch history — recommendation is based on narrative and tone fit." Keep the Crew heading and say so in one short, plain line, like "No one you follow in this one" (draft copy).

7. **The games' "Why this pick?" panel** is part of this task too: its "FINGERPRINT" label becomes "Why".

**What it doesn't show**
The match ring, Play Trailer, Add to Watchlist, the streaming service (Paramount+, Amazon…), Loved / Liked / Disliked, the X, or the share button. All of those stay on the card underneath.

**Look**
A **sheet that slides up** over the card and covers almost the whole screen, so the long content has room and scrolls inside it. Close it with an **X** at the top, by swiping down, or with the phone's back button. No app top bar (back, share, menu) on it. Today it's a full screen with a back arrow.
The sheet is a thick dark layer on top of the title. It doesn't have to be fully opaque, but nothing busy shows through. **No blurred poster behind it**: it makes the text hard to read.
**The story lines only say what it is:** this screen is "why we recommend it". The "Label: value" lines show the title's own values and never point out where it doesn't match you. (Don't recommend a sushi plate and then write "Tuna: no".)

**Rule to keep (confirmed by Eran 2026-11-04)**
Every recommendation explains what works **and** what doesn't (a standing product decision). The written "why" already does this ("your one likely reservation is…"), and the "Doesn't quite fit" list can hold real reasons against, like a director you rated down. Drop the filler line when there's no crew, but keep real reasons against, in the same plain style.

**Open questions**
- None left. Draft copy ("Why", "No one you follow in this one") gets its final wording at the mock stage.

**Build notes (for whoever picks it up)**
- The screen is `WhyDetailOverlay` in `src/modules/session/recommendations/RecommendationsView.tsx`. Its sections (score breakdown, crew, story side, reasons against) come from `WhyPanel` in `src/app/components/RecCard.tsx`.
- With Loved / Liked / Disliked gone from this screen, the card's "Seen it?" row (see the Seen task above) is the only place to rate.
- **Process:** one JPEG mock per state before building: the sheet opening over the card, the full sheet, a title with crew matches, a title with none, and a title with a real reason against.

**Done when**
- The screen shows only the title, metadata, the why, bars without weights or numbers, "Label: value" lines without Format, and crew names.
- None of the card's buttons, the match ring or the streaming service appear on it.
- It opens as a sheet over the card, on a thick dark layer with no poster behind it, and closes with the X, a swipe down or the back button.
- Real reasons against still show. The no-crew filler line is replaced by one short line.
- The games' "Why this pick?" panel says "Why", not "FINGERPRINT".
