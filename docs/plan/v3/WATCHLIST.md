# Watchlist for the next round: decisions and open questions

Started 2026-11-17, with Eran, the same way as For you. Numbers: `EVIDENCE.md` §4 (the long list) and §3 (where to watch).
Mocks: `docs/prototypes/watchlist-v3/` (real feed capture + today's tab bar; `build.py` then `render.py`).

**Status: decided with Eran, 2026-11-18.** Ready to be cut into build tickets (owner: Shahar, A1; see DEC-9 for the chat side).

## 0 · The Watchlist today (from the code, NAV_TABS on)

**Getting there.** The Watchlist tab (`?stage=watchlist`). It is `RecommendationsView` in `mode="watchlist"`: the same screen as
For you, with a different list behind it. The header says "Watchlist (N)"; the chat bubble top-left, search top-right (scoped: saved
titles first). No Movies / Series / Both (`docs/watchlist-plan.md` #3).

**What gets in.** "Add to Watchlist" on a For you card, a Search result, a shared title page (`/t/…`), or the chat ("Added X to your
watchlist"). The whole card is stored as it was served, with the "Why" breakdown of that day. Cap 200.

**What goes out.** Only "Remove from watchlist" (the card's yellow button). A rating never removes: the card stays, the chip stays lit
and the prompt says "Saved to Ratings". Unsaving tells the fingerprint, so the title can come back to For you.

**Order and paging.** Sort by: Year, Date Added (default, newest first), Rating (the ★ score, not yours), Name. 6 cards a page,
more as you scroll. No filter, no search inside the list beyond the header search.

**Rated from the Watchlist.** Loved / Liked queue the 48-hour check-in (the only place that does); Disliked doesn't.

**The card.** Identical to For you: poster with the US service pill and the match ring, title · year · length · ★, share and trailer,
one fresh "why" line built from facts (`/api/recommendations/why-lines`; the saved AI line is not shown), "Why it's a match"
(opens the saved breakdown: real bars for 41%, old guessed bars 25%, none 34%), "Remove from watchlist", Seen it? chips. No X.

**Empty.** "Nothing saved yet. Tap "Add to Watchlist" on a recommendation to keep it here." plus a "Browse recommendations" button.

**Tab bar.** A white count badge on the Watchlist tab; it counts everything on the list, rated titles included.

**Numbers (EVIDENCE §4).** Alon 55 saved (0 rated), Shahar 16 (3 rated), Eran 17 (2 rated). Alon's 55 sit on 11 US services + 18 with
none; the biggest, Netflix, has 7.

## R · What other apps do (2026-11-17), and what it means for us

- **Letterboxd:** the watchlist is a wall of posters, with sort, and (Pro) a filter by your streaming services, data from JustWatch.
  Marking a film watched takes it off the watchlist; third-party "pick a random film from my watchlist" tools are popular enough
  to exist four times over.
- **IMDb:** rating does not remove; IMDb declined to auto-remove because people use the list for other things. "Mark as watched" is a
  separate button. Filters live on the web only.
- **Plex:** started auto-removing watched items and users revolted ("my rewatch list is gone", "no control"); the fix was a switch.
- **JustWatch:** the watchlist has a "My services" filter; finished series move to a Seen list by themselves.
- **Netflix My List:** sorted by predicted interest, not by date; "leaving soon" titles are called out and pulled forward.
- **Apple TV:** split "Up Next" (in progress) from "Watchlist" (saved on purpose) in 2024, because mixing them confused people.
- **Surveys (Plex 2022, 2,000 US adults):** the average list holds about 29 titles; two thirds say they can't get through it, because it
  keeps growing (43%), is too long (29%), feels overwhelming (25%).

**What it means:**
1. A watchlist's enemy is its own length. Every app that survives it gives three tools: a dense view, a filter by *your* services,
   and a way to pick one for tonight.
2. Nobody auto-removes on rating and gets away with it. Our rule (rating keeps the title) is right; the fix is to *show* rated titles
   apart, not to drop them.
3. The decision tool is the gap. Letterboxd users build it themselves; we have a chat that already knows the list.

## DEC · Decided

Each has a mock in `docs/prototypes/watchlist-v3/` (the JPEG named in brackets). Settled with Eran 2026-11-17/18.

- **DEC-1 · Rows, not cards.** The Watchlist is one row per title: poster 82×123, title, year · length · ★, then where it streams
  (Israel) and the match in gold; about four titles a screen. The For you card is not reused on the list. The row ratio may still be
  tuned. Chosen over a poster wall (too crowded) and over today's cards (about 50 screens for Alon's 55). [4-air, 5-tap]
- **DEC-2 · Tap a row: the title's card page, with the breakdown on it.** The card you know from For you opens as its own page;
  Back returns to the list. The "Why it's a match" button is gone from this page: the sheet's content (Why, Score breakdown, What
  it's like, Crew) sits under Seen it?, in the sheet's own styles. One tap from the list to everything about a title. For you keeps
  its button and sheet. The long why takes 1–3 s to write, so three quiet skeleton lines hold its place; a saved title with no
  breakdown (34% today) shows Why and Crew only, no bars and no error line. The shared title page (`/t/…`) can become this same
  page. [5-tap, 11-why-on-card]
- **DEC-3 · Filter chips on top, WhatsApp-style, in the card's own chip style.** One row that scrolls sideways, one chip lit at a
  time, a count on each. The set, in order: All · Starred · Movies · Series · one chip per service TMDB knows for Israel (Netflix,
  HBO Max, Apple TV, Prime Video) that has at least one title on the list · Seen. Never more than nine. The header count is always the
  whole list; the chip count is the part. A filter with nothing behind it says so in one line and the chip stays lit. **Added
  2026-11-18 (Eran):** service chips only while the region has at most 5 known services; with more than 5 (the US has 11 on Alon's
  list alone) the services become one filter control (a single "Services" chip opening a picker), not a row of chips. Israel today
  has four, so chips. [6-filter, 13-seen, 9-empty]
- **DEC-4 · Star to prioritise.** A star on every row and on the card page (a circle above share). Starred titles sit at the top of
  the list; the Starred chip shows only them. No drag-and-drop. (A pin was floated because ★ is also the rating on every row; Eran
  kept the star.) [5-tap]
- **DEC-5 · Rated titles sink under a "Seen" line at the end of the list; nothing leaves by itself.** The row keeps its poster
  (dimmed) and shows your reaction in place of the match. Order from top to bottom: starred, the rest, the end card, the "Seen" line,
  the rated titles. The Seen chip shows only them. Only Remove takes a title off. [7-seen B, 13-seen]
- **DEC-6 · Seen never takes a title off the counter.** "Watchlist (55)", the All chip and the tab badge all count rated titles too.
- **DEC-7 · No sort.** Today's "Sort by" bar goes and nothing replaces it; the list is newest-saved first, starred on top, Seen last.
  The design for bringing it back is parked below (§P). [5-tap]
- **DEC-8 · Swipe a row left to remove it.** A shortcut; the card page keeps "Remove from watchlist". The row folds into a one-line
  note with Undo that stays about 5 seconds, then folds and the list closes the gap; a second swipe closes the first note at once.
  The counts (header, All chip, tab badge) drop at once. Remove on an open card page: Back to the list at once, where the row folds
  into the same note; one mechanism. [8-remove]
- **DEC-9 · The end card is one ask: an invite to talk.** Under the last unseen row, before the Seen line, under All only, when the
  list has three or more unseen titles. In For you's end-card style, one orange button. It opens the chat knowing it came from the
  Watchlist, so the chat's first line can offer both: what's on your list, or something new. No "pick one for tonight", no second
  button. The mood is "need help deciding", not "nothing jumps out": reaching the end of the list says nothing about what the person
  thinks of it. **Copy is a placeholder** (card: "Need help deciding? Let's talk it over." · button: "Let's talk" · chat opener:
  "Want to talk about what's on your list, or something new?"). Who builds it: Shahar, in two places: the card and button on the
  Watchlist page (`RecommendationsView`, A1's `src/modules/session/`, reusing For you's end-card styles `nudge` / `nudgeEyebrow` /
  `nudgeText` and the orange `watchlistBtnPrimary`, to the JPEG and the copy above, nothing designed anew), and the chat's entry
  from it and its first line (his P3 work: #251 entry, #252 the chat already reads the newest 20 unrated saves). The build ticket
  carries the JPEG, the class names and the exact strings. [10-end]
- **DEC-10 · No blue buttons.** The empty state's button becomes the app's orange primary; today's blue `browseBtn` goes. Text:
  today's, with "Go to For you" for the button. [9-empty]
- **DEC-11 · Where to watch, Israel.** A row shows one of Netflix, HBO Max, Apple TV, Prime Video (TMDB's Israeli data); a title on
  none of them shows nothing in that slot, just the match (the row never says what it doesn't have; the service chips answer "what's
  on Netflix"). yes, HOT, Cellcom, Partner and Disney+ are unknown to TMDB. No search box inside the list; the header search already
  puts saved titles first. **Added 2026-11-18 (Eran):** the Israeli data replaces the US data everywhere a service is shown, the
  card's service badge included (For you and the card page); the US value stays stored, unshown. Until now the app showed US
  services by default, never by decision.
- **DEC-12 · It moves, gently.** Swipe follows the finger; Remove folds the row into the note; when the note goes the list closes
  the gap; a filter change re-orders with a short fade or slide, not a cut. Motion plays even under the phone's reduce-motion
  setting, as elsewhere in the app.
- **DEC-13 · The card page keeps the card's spacing.** With the "Why it's a match" link gone, the Remove button keeps the same
  room under the why line that the link used to give (about 18px), so the text and the button don't touch. [5-tap]

## Q · Open

(none; every point raised is in DEC above or parked in §P)

## + · Added to v3 by Eran, 2026-11-18 (cross-cutting, not only the Watchlist)

- **Region.** The app should know where the person is, set by hand or detected (Eran: "either manually or automatically, I don't
  know"), and show that country's streaming data everywhere, with the chips-or-filter rule above following the country's number of
  services. Today Israel is the one region built in. Not part of the Watchlist v3 build PR; to be planned with the rest of v3.

## P · Parked: the sort, if it ever comes back (2026-11-18)

Eran: "it's exactly what I thought it should be, I just suddenly don't think its functionality is actually needed." Mock
`12-sort.jpg` (states `k2-sortmenu`, `k3-sortyear`) is the plan to revert to:
- Today's own sort control, label and all ("Date Added" + chevron, `sortTrigger`), sits at the end of the filter-chip row, on a
  short black fade so the chips scroll under it; no separate "Sort by" line.
- It says what the list is sorted by; tapping it opens today's menu (`sortPanel`: Date Added, Year, Rating, Name, the current one
  highlighted) and the list fades back (`contentDimmed`), exactly as today.
- No up/down toggle: each sort has one fixed direction, as today (newest saved, latest year, highest ★, A to Z). The pill's label
  changes to the chosen sort.
- A filter and a sort combine (Netflix sorted by Year). The sort sorts inside each part of the list: starred stay on top, Seen stays
  last.
