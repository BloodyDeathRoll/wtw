# Backlog

Things we've decided to come back to. Newest first. When one gets picked up, move it to `docs/INTEGRATION.md`; when it ships, delete it here.

| Added | Item | Notes |
|---|---|---|
| 2026-11-04 | **Split the card into "Want it?" and "Seen it?", plus a new Seen section** | The X moves next to Add to Watchlist (accept or reject). Loved / Liked / Disliked only rate: the button stays highlighted, the card stays where it was, and the title goes to Seen, a new main section next to Recommendations, Watchlist, Play and Search. Full task: [Seen — task details](#seen--task-details). |
| 2026-11-04 | **Search: adding a title teaches your taste** | Eran decided it should. The MVP only saves the card. Needs the DNA writer (A3) to take a "saved from search" signal. |
| 2026-11-04 | **Search: match % and "Why it's a match"** | The MVP card has no score. Same missing piece as the shared page's match: the engine scoring one title on request (A2), plus an AI call for the reason (a 1–3s wait, free-tier limits). |
| 2026-11-04 | **Search: "Seen it? Tell me how it was" on the card** | Left out of the MVP; small once the taste signal above exists. |
| 2026-11-04 | **Search: suggestions from the first letters, and forgiving typos** | TMDB only matches whole words ("se" → junk). Our 35k could do it, but `title ilike 'se%'` took 7.3s: needs a trigram index on `titles.title` (one migration), which also gives typo tolerance. |
| 2026-11-04 | **Where to watch in Israel, not the US** | Search, the feed and the shared page all read the US listing (`WATCH_REGION`), so Shtisel says Chai Flicks, not Netflix, and titles outside our catalogue show nothing. Changing it touches all three. |
| 2026-11-04 | **Search for people** | The new Search (menu, under Play) is titles-only in v1. Later: type a director, writer or actor ("Nolan") and get their titles. TMDB has a person search; `searchPerson` in `src/lib/tmdb.ts` already resolves a name to one person. |
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
