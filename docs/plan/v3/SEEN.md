# Seen for the next round: decisions and open questions

Started 2026-11-18, with Eran, the same way as For you and the Watchlist (`WATCHLIST.md` is the model).
Mocks: `docs/prototypes/seen-v3/` (a capture of today's Seen page plus the Watchlist's mock library; `build.py` then `render.py`).
In the mocks, which title got which reaction is sample data; posters, years, lengths and ★ scores are TMDB's.

**Status: decided with Eran, 2026-11-18.** The final shape of the list is `7-icons`. Mocks 1–6 came first: where they differ
from 7, 7 wins. They still show the card page, clearing a rating, the hidden list and the empty state.

## 0 · Seen today (from the code, NAV_TABS on)

**Getting there.** You → Seen card → "See all N". It is `RatingsView` (`src/modules/session/ratings/`), a stage of `WTWApp`
titled "Seen", under the tab bar with You lit. Data comes from `GET /api/recommendations/ratings` (recommendation_feedback plus
removed_titles).

**The page.**
- A big count, "N titles reviewed".
- Four tiles: ❤️ Loved, 👍 Liked, 👎 Disliked, × Removed.
- A bar with "LOVED TITLES" and two dropdowns: All / Movies / Series, and Date Added / Oldest First / Title A–Z.
- Bare title rows with no poster. Tap one and it opens three buttons (Loved / Liked / Disliked) to re-rate. A rating can't be
  cleared here.
- Removed rows open "Restore so it can show up in recommendations again." with a Restore button.
- Empty: "Nothing in Loved yet." / "You haven't removed any titles."

**What gets in.**
- Loved / Liked / Disliked on a For you card, a Watchlist card, or the onboarding cards.
- The X on For you, which lands under Removed.
- The card's line after a rating says "Saved to Ratings".
- Games' Loved / Liked / Disliked go to `play_events` and never reach Seen.
- Search has no Seen-it chips.

## R · What other apps do (2026-11-18), and what it means for us

- **Letterboxd:** your Films list is posters with your rating on each, plus filters and sorts (by when you watched or rated,
  by title, by rating). Changing a rating happens on the film's page.
- **IMDb:** renamed "Seen" to "Watched", a separate button from rating. Your ratings list sorts by date rated, title or your rating.
- **JustWatch:** can hide titles you've seen from everything it suggests. Seen is a filter on the whole app, not just a page.
- **Spotify (heart on every song), Gmail (star on every email), YouTube Music (thumbs on every song):** a one-tap action on each
  row of a long list is normal. People mis-tap now and then; an easy undo is what makes that fine. Phones don't count a scroll as a
  tap, and on Android Chrome a tap that stops a list mid-glide doesn't count either.

**What it means:** Seen should look like the Watchlist (posters, the same rows), but it isn't the Watchlist. It grows forever
(every rating lands here, 300 isn't strange), so unlike the Watchlist it needs a type filter and a sort. Its one job beyond
looking back is fixing a rating, so that should take one tap.

## DEC · Decided

- **DEC-1 · Seen uses the Watchlist's rows.** Poster 82×123, title, year · length · ★, then your reaction where the Watchlist
  shows the match. No star, no "where to watch". Header "Seen (N)", N = every title you rated. Back (top left) returns to You and
  the You tab stays lit; search stays top right. The big count and the four tiles go. (Eran, 2026-11-18) [1-shape, right; 7-icons]
- **DEC-2 · Chips: Loved · Liked · Disliked · Hidden from For you. No "All"; Seen opens on Loved.** Each chip shows its count;
  one is lit. Hidden from For you is the last chip, at the far right; on a phone you swipe the chips to reach it. (Eran,
  2026-11-18) [7-icons]
- **DEC-3 · Today's two dropdowns stay, under the chips.** All / Movies / Series, and Date Added / Oldest First / Title A–Z,
  with today's wording and look. Date Added (newest rated first) is the default. Unlike the Watchlist, which has no sort, Seen
  grows forever, so sorting and the type filter earn their place. (Eran, 2026-11-18) [7-icons]
- **DEC-4 · Change a rating right on the row.**
  - Each row carries the card's three reaction buttons, icons only (❤️ 👍 👎), in the card's chip style. Yours is lit in gold;
    the other two are dimmed a little (about 55%).
  - Tap another icon and the gold moves to it at once.
  - The row stays where it is, with the Watchlist's note under it: "**Memento** will move to Liked." with Undo. The chip counts
    change at once. The row leaves Loved the next time you open Loved.
  - A stray tap while scrolling therefore costs one tap to fix, and nothing vanishes from under your finger.
  - (Eran, 2026-11-18) [7-icons]
- **DEC-5 · Tapping the lit icon on a row does nothing.** Clearing a rating stays on the card page (DEC-7). A row is where
  stray taps happen, and clearing makes your taste forget the title. (Claude's call, from Eran's worry about mis-taps; Eran
  approved the whole write-up, 2026-11-18)
- **DEC-6 · Tapping a row (poster or title) opens the title's card page.** It is the same page as the Watchlist's (its DEC-2,
  with the breakdown on the page), with these differences:
  - Your reaction is lit, and the line above it says "Saved to Seen". Today it says "Saved to Ratings"; that changes
    everywhere.
  - The button row is Add to Watchlist alone, for a rewatch. There's no Hide, because a seen title never comes back to For you
    anyway.
  - Where-to-watch follows the Watchlist's Israel rule (DEC-11 there).

  (Eran, 2026-11-18) [3-tap]
- **DEC-7 · Clear a rating from the card page: tap your lit reaction again.**
  - On the card page, all three go unlit, and the prompt comes back.
  - Back on Seen, the row folds into the Watchlist's note: "Rating cleared. **Memento** is out of Seen, and your taste forgets
    it." with Undo. The counts drop.
  - There's no swipe on Seen, because clearing changes your taste.

  (Eran, 2026-11-18) [4-clear]
- **DEC-8 · Hidden from For you** (today's "Removed") is a chip, not a tile, because a title you hid isn't one you've seen.
  - Its list uses the same rows, with no reaction icons.
  - A short line on top: "You hid these on For you, so they never come back there. Restore one and it can."
  - Each row has a yellow Restore. Restore folds the row into a note: "Restored. **The Hunger Games** can show up on For you
    again." with Undo.

  The entry point in 5-hidden (a quiet row at the end of the list) is replaced by the chip in DEC-2. Its middle and right phones
  still show the list. (Eran, 2026-11-18) [5-hidden, middle and right; 7-icons]
- **DEC-9 · Empty states.**
  - Nothing rated: "Nothing here yet. Tap Loved, Liked or Disliked on any title you've seen and it lands here." plus the orange
    "Go to For you". No chips or dropdowns.
  - A chip with nothing behind it: one line ("Nothing disliked yet."), with the chip still lit. The All chip in that mock no
    longer exists.

  (Eran, 2026-11-18) [6-empty; 2-filter, right]

## Q · Open

None.

## P · Parked, or someone else's

- **Games' ratings don't reach Seen** (they go to `play_events`). Games are out of this round. Flag it when Games come back.
- **Seen-it chips in Search.** Search has none today. Settled in `SEARCH.md` (the next part).
- **Hiding seen titles everywhere** (JustWatch's way). Seen titles already never come back to For you. Search and the chat are
  their own parts.
