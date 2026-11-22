# Search for the next round: decisions and open questions

Started 2026-11-18, with Eran, the same way as For you and the Watchlist (`WATCHLIST.md` is the model). No mocks: every screen
Search opens is one already decided (the card page in `WATCHLIST.md` and `SEEN.md`); the list itself barely changes (Eran).

**Status: decided with Eran, 2026-11-18.** Finding a title from a description is parked (§P).

## 0 · Search today (from the code, NAV_TABS on)

**Getting there.** The magnifier at the top right of every tab (`HeaderSearch`) opens `/search` over the screen, and Back
returns to it. Opened from the Watchlist or Seen, your own matching titles come first: "In your Watchlist" or "In your ratings",
then "All titles".

**Typing** (`src/app/search/SearchView.tsx`, `GET /api/search`).
- Before you type: the box says "Search titles and people", with nothing under it.
- From two letters on, the list comes on its own once you pause, with "Searching…" meanwhile. The keyboard's search key
  searches at once.
- It shows up to six results from all of TMDB, not just our catalogue, best-known first.
- TMDB only matches whole words, so "sl" brings junk, not Slow Horses. A typo in a longer name is retried with each word left
  out; a one-word typo ("shtisle") finds nothing.

**The list.**
- A title shows its poster, name, year (· series) and its two lead actors (`/api/search/cast`, after the list shows).
- A person shows their photo, Director or Actor, and what they're known for. Tap one and their page lists their titles, newest
  first (`/api/search/person`).
- Nothing on a row says whether you've saved or rated the title.
- Notes: "Nothing like that. Check the spelling?", "Search isn't working right now. Try again in a moment."

**Tapping a title** (`/api/search/title`, the shared page's lookup). It opens the feed's card without the match ring, "Why it's a
match" or Seen it?, so you can't rate a title you found. The reason line is the TMDB synopsis. The card has Add to Watchlist /
Remove from watchlist, Share and the trailer, and the where-to-watch pill is the US listing. Adding only saves the card; it
doesn't teach your taste. Back walks card → person → list (`?t=` / `?p=` in the URL).

## R · What other apps do (2026-11-18), and what it means for us

The web search came back thin (mostly vendor blogs, plus Netflix's help pages and Letterboxd's own pages), so this is common
practice, not measured numbers.

- **The empty box:** nearly every search guide (Algolia, Kodeco) names a blank screen under the box the worst mistake. Apps
  put recent searches or suggestions there.
- **Netflix:** testing a search where you describe what you're in the mood for, in your own words (help.netflix.com, "A new
  way to search on Netflix", 2025).
- **Letterboxd:** search sits beside "Browse by" genre or streaming service. Your own rating shows on your films.
- **JustWatch:** marks what you've seen and can hide it.

**What it means:** Search is the one place in WTW where you bring the title and we bring the taste. Today it brings TMDB's
card and stops. Growing up means that whatever you find gets the full WTW card, and the list knows what you've already done.

## DEC · Decided

- **DEC-1 · Search finds a title; the chat helps you decide what to watch.** That's how people think about it: you go to
  Search when you're looking for a title, and to the chat when you want advice. It sets what belongs where in this round and
  the chat's next step. (Eran, 2026-11-18)
- **DEC-2 · Every title you tap opens the live card.**
  - That covers a title tapped from the results, from an actor's or director's page, or from "In your Watchlist / In Seen".
  - It's the same card page as the Watchlist and Seen (`WATCHLIST.md` DEC-2, `SEEN.md` DEC-6), in whatever state that title is
    for you:
    - Add to Watchlist, or Remove from watchlist if it's saved.
    - Loved / Liked / Disliked, lit if you've rated it.
    - Your match % and its breakdown.
    - Where to watch in Israel (`WATCHLIST.md` DEC-11: only Netflix, HBO Max, Apple TV or Prime Video, and nothing when it's on
      none of them).
    - Share and the trailer.
  - In short, the card you'd get for that title anywhere else in WTW. (Eran, 2026-11-18)
- **DEC-3 · The match % only where we can score it honestly.**
  - A title in our catalogue (about 35,000) gets scored for you on request.
  - The card shows at once, and the ring and breakdown fill in when the score arrives (about a second). Nothing waits on it.
  - A title outside the catalogue (Shtisel, for one) gets the live card without the ring or the breakdown; nothing is made up
    in their place.
  - Owner of scoring one title on request: Alon (A2); it is the same missing piece as the shared page's match. (Eran,
    2026-11-18)
- **DEC-4 · What you do in Search counts, like anywhere else.**
  - A rating lands in Seen and your taste (`SEEN.md`).
  - Adding to the Watchlist counts the same as a save from For you: the title is marked saved right away. A save doesn't
    change the taste model today, from For you or Search; making it do so is its own decision, with harness numbers before
    and after. (Eran, 2026-11-18; corrected 2026-11-20 and 2026-11-22, #368)
- **DEC-5 · Each result shows where it stands with you.**
  - The row's third line (today the lead actors) starts with your mark when there is one: ❤️ Loved, 👍 Liked, 👎 Disliked,
    In your Watchlist, or Hidden from For you. You can see it without opening anything.
  - The actors follow when there's room. (Eran approved the write-up, 2026-11-18)
- **DEC-6 · Results from the second or third letter.**
  - "sl" should already offer Slow Horses. That means matching the start of words in our own catalogue (a fast-lookup index on
    the titles' names, one database change; today such a lookup took 7.3s).
  - TMDB still answers whole words, so a title outside our catalogue shows up once its word is typed.
  - The two lists merge, best-known first, with no doubles.
  - The same index can also catch a one-word typo ("godfahter").
  - Not from the first letter: one letter matches too much to be useful. (Eran, 2026-11-18)
- **DEC-7 · Your recent searches fill the empty box.**
  - Before you type: your last few searches (about six), newest first. Tap one to search it again; a Clear link empties them.
  - They're kept on this phone only and never sent to us.
  - Nothing there yet: the box alone, as today. (Eran approved the write-up, 2026-11-18)
- **DEC-8 · Opened from the Watchlist or Seen, your own titles still come first.** They're under "In your Watchlist" or
  "In Seen" (today "In your ratings"; Seen is the page's name now). Then "All titles". (Eran approved the write-up, 2026-11-18)
- **DEC-9 · The rest stays as today.**
  - Placeholder: "Search titles and people".
  - People in the same list, each with their page of titles, newest first.
  - The lead actors under each title.
  - "Searching…" while you wait.
  - The keyboard's search key.
  - Back walks card → person → list → the screen you came from (`YOU.md` DEC-1).
  - The notes for nothing found and for a failure.

## Q · Open

None.

## P · Parked

- **Find a title from what you remember of it** ("the one where the guy relives the same day"). It belongs in Search, by
  DEC-1, since it's finding a title. It's parked for now (Eran, 2026-11-18). Notes for when it comes back:
  - It takes a few seconds and the AI, which is too slow and too costly for every keystroke.
  - Claude's suggestion: a last row in the results, "Not it? Find it from what you described". Tapping it brings three to five
    guesses.
  - Each guess must be checked against TMDB, so only real titles show, with a line on why we think it's that one, built from
    facts.
  - The search box hint would then say "Search titles, people, or describe it".
  - Backlog row 2026-11-05.
