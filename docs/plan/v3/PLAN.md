# WTW v3 — execution plan: ready for friends

Written 2026-11-18 by Eran with Claude, the same way as v2 (`docs/plan/PLAN.md`).
This file is written for each teammate's Claude Code. Read all of it before claiming a work package.
The numbers behind it are in `docs/plan/v3/EVIDENCE.md`. Each part's decisions, with the reasons, are in its own file:
`FOR-YOU.md` · `WATCHLIST.md` · `YOU.md` · `SEEN.md` · `SEARCH.md` · `CHAT.md` (all in `docs/plan/v3/`).

## The plan in plain words (for people; Claude, read on below)

**Why we're doing this.** v2 made the recommendations good. v3 makes the app ready to hand to friends. We measured what a
newcomer would hit (`EVIDENCE.md`):
- **For you shows the same cards over and over:** 45% of titles were shown more than once, and 60% of cards never got a reaction.
- **The X confused everyone.** It said nothing, and had no Undo.
- **"Why it's a match" still tells small untruths.** A "Creators 27%" shows up when nobody you know is in the title. Saved
  titles show breakdowns frozen on the day they were saved.
- **Back leaves the app.** Seen is a bare list, Search stops at TMDB's card, and there's no way to send feedback or delete an
  account.

**What changes:**
1. **For you becomes a set of 20 that stays put** until you tap Refresh. Hide replaces the X, and says what it does, with Undo.
   Cards you looked at and skipped rest for a while and come back less and less. "Why it's a match" only says true things.
   (Eran's lane.)
2. **Seen looks like the Watchlist.** You change a rating right on the row, with Undo, and hidden titles can be restored there.
3. **Search grows up.** Every title you find opens the full WTW card, with your match where we can score it honestly. Results
   come from the second or third letter, show what you already did with each title, and your recent searches wait in the empty box.
4. **The app behaves like an app.** The phone's Back retraces your steps, and every tab remembers where you were.
5. **You grows up.** "Send us feedback" goes straight to our inbox, and an Account page has Sign out, Start my taste over and
   Delete my account.
6. **The Watchlist is already done** (#345, #346), all but its end card, which invites you to talk it over in the chat.

**What's not in this round:** Games, the brain, and new chat work. The chat stays as it is; its future is v4's first question
(`CHAT.md`).

**In what order.** Two phases, then friends:
- **Phase 1, steady and honest:** For you, "Why it's a match", Back and tabs, the Watchlist's end card.
- **Phase 2, Seen, Search and You.**
- **Friends launch:** a short checklist, then we invite people.

Phases are about what *reaches users*. Work on phase 2 starts on day one, switched off until its gate.

**How we work.** Three lanes, each with its own files:
- **For you:** Eran.
- **Screens:** Shahar. Seen, Search's screens, Back and tabs, and the Watchlist's end card.
- **Engine and server:** Alon. Scoring one title on request, fresh breakdowns, Search from two letters, and You's feedback,
  Account and delete.

Every task is a GitHub issue on the [WTW v3 board](https://github.com/users/BloodyDeathRoll/projects/2).

**Two promises:**
- **Nothing that works today breaks.** Every change of behaviour ships switched off and is turned on at its gate.
- **Every screen is built exactly as Eran approved it.** The JPEG and the words are the spec, and Eran signs off every PR that
  changes a screen before it merges (§0).

Every task below starts with a one-line **"In plain words"**. The rest of each task is the technical detail for Claude.

---

## 0. How to work from this file

- **Two places hold the plan:**
  - This file and the part files are the **spec**: what to build and how.
  - **GitHub Issues** hold the **status**: one issue per work package (WP), with the WP id in the title, e.g. `[v3 S2] Change a
    rating right on the row`. Don't tick boxes in this file.
  - **The board** shows all of it at a glance: [WTW v3](https://github.com/users/BloodyDeathRoll/projects/2) (Todo / In Progress /
    Done). With `gh`: `gh project item-list 2 --owner BloodyDeathRoll`.
- **Your tasks are already assigned** (Eran, 2026-11-18). To pick the next one:
  1. Find your list, **in order**, in §3a. The same list is on GitHub: `gh issue list --assignee @me --label v3 --state open`.
  2. Take the first task whose "Depends on" issues are all closed. If it's blocked, take the next one and say so on the blocked
     issue.
  3. Move its card to "In Progress", and branch off `main`, named after the WP, e.g. `feat/v3-s2-rate-on-row` (`GITGUIDE.md`).
  4. Reassigning is fine. Tell the others and change the assignee on the issue.
- **One WP is one branch and one PR.** Split a PR that grows past about 600 changed lines. The PR body says `Closes #<n>`.
- **Screens are built exactly as approved (Eran, 2026-11-18). This is the rule that matters most in v3.**
  1. **The JPEG and the part file's words are the spec.** Every WP with a screen links its approved JPEGs and quotes its strings.
     Build to them pixel for pixel, with the app's existing classes named in the spec. No new colours, sizes, words or icons.
  2. **No mock, no build.** If a state you need isn't in an approved JPEG, stop. Post a mock (the
     `docs/prototypes/watchlist-v3/build.py` + `render.py` pipeline makes them from the real CSS) on the issue and wait for
     Eran's OK. WPs that need one say "**Mock first**".
  3. **The PR shows its proof.** For each state: a phone-width screenshot (375 px, Android Chrome or its emulation) next to
     its approved JPEG.
  4. **Eran approves the PR before it merges.** Those issues carry the label `ui-signoff`; request a review from `eran-manor`.
     A PR that changes no screen doesn't need it.
- **Nothing breaks (Eran, 2026-11-18).**
  - Every change of behaviour goes behind a flag (§8) whose default is today's behaviour.
  - When something new fails, fall back to what's there today, never to an error. For example, if a fresh breakdown can't load,
    show the saved one.
  - Before every PR, walk today's screens your change touches, flag off and flag on, and say so in the PR.
- **Ownership.** Every WP names its module owner (A1 = Session Brain, A2 = Recommendation Engine, A3 = DNA Schema Writer).
  - CLAUDE.md's "others do not modify" rule is relaxed only for the files a WP lists.
  - A PR that touches another owner's files says so in its first line.
- **When this file and the code disagree:** the code wins on facts, this file wins on intent. Stop and comment on the issue
  before you build. When this file and a part file disagree, the part file wins on the detail of a screen; say so on the issue.
- **At the end of every session**, add one line per landed WP to `docs/INTEGRATION.md`, under the heading "v3 plan" (standing
  rule in CLAUDE.md).
- **Glossary:**
  - **the 20** = the set of about 20 For you picks that stays put until Refresh.
  - **card page** = a title's card as its own page, with the breakdown on it (built for the Watchlist in #345).
  - **stopped on** = at least half the card on screen for at least a second.
  - **resting** = a skipped card held back for a while (`FOR-YOU.md` DEC-6).
  - **scored on request** = the engine scoring one title for one person, outside a batch (M1).

---

## 1. Decisions (DEC-n) — do not re-litigate

The full lists, with reasons and mocks, are in the part files. These are the ones that cut across parts.

| # | Decision |
|---|---|
| DEC-1 | **Shop window, not an inbox.** For you is a steady set of about 20 that changes only when you tap Refresh. No endless scroll, no refresh by itself, no pull-down (`FOR-YOU.md` DEC-1–3). |
| DEC-2 | **Every button says what it does, and offers Undo.** Hide ("Your taste isn't changed"), Remove (Watchlist), a moved rating (Seen), Restore (Hidden): each folds into a one-line note with Undo (`FOR-YOU.md` DEC-5, `WATCHLIST.md` DEC-8, `SEEN.md` DEC-4, DEC-8). |
| DEC-3 | **"Why it's a match" says only true things.** No Creators number when nobody you rated is in the title. A breakdown is always today's, never frozen at save time. A stretch pick says it's a stretch (`FOR-YOU.md` DEC-8–10). |
| DEC-4 | **One card page everywhere.** Tap a title in the Watchlist, Seen or Search and you get the same card page, in that title's state for you (`WATCHLIST.md` DEC-2, `SEEN.md` DEC-6, `SEARCH.md` DEC-2). |
| DEC-5 | **The match % only where we can score it honestly.** A catalogue title is scored on request; a title outside the catalogue shows no ring and no breakdown, and nothing is made up in their place (`SEARCH.md` DEC-3). |
| DEC-6 | **Search finds a title; the chat helps you decide** (`SEARCH.md` DEC-1). The chat gets no new work this round (`CHAT.md`). |
| DEC-7 | **Where to watch is Israel's**: Netflix, HBO Max, Apple TV or Prime Video, and nothing when a title is on none of them (`WATCHLIST.md` DEC-11, shipped in #345). |
| DEC-8 | **"Seen" is the name.** "Saved to Ratings" becomes "Saved to Seen" everywhere; "In your ratings" becomes "In Seen" (`SEEN.md` DEC-6, `SEARCH.md` DEC-8). |
| DEC-9 | **No blue buttons.** The orange primary (`watchlistBtnPrimary`) is the one main action style (`WATCHLIST.md` DEC-10). |
| DEC-10 | **Back retraces your steps, then For you, then out; every tab remembers where you were** (`YOU.md` DEC-1–2). |
| DEC-11 | **No change to `src/types/dna.ts`.** If a WP seems to need one, stop and raise it: it's the shared contract. |

---

## 2. Phases and gates

| Phase | Goal | Gate to leave it |
|---|---|---|
| **1 Steady and honest** | For you as a set of 20 with Refresh, Hide and resting. True "Why"s. Back and tabs behave. The Watchlist's end card. | P1-G (§4) |
| **2 Seen, Search, You** | Seen redesigned, Search opens the full card, You has feedback, Account and delete. | P2-G |
| **Friends launch** | The launch checklist (§6), then invites. | L-G |

**Phases are launch gates, not a strict order of work.** Alon's M1 and Q4 and Shahar's Seen work start on day one, switched off
for users. What waits is only what a phase *ships to users*.

---

## 3. Lanes, capacity and order

> **In plain words:** three lanes, each with its own files, so two people rarely edit the same file. **For you** is Eran's. The
> rest splits in two, roughly even: **screens** (Shahar) and **engine and server** (Alon). A few files are shared; for those,
> one open PR at a time (§8).

| Lane | Owner | Files it owns in v3 | WPs, in order | Effort* |
|---|---|---|---|---|
| **F — For you** | Eran (A3) | The feed parts of `src/modules/session/recommendations/RecommendationsView.tsx` (+ `.module.css`): `FeedCard`, `CalibrateNudge`, the list, the end card; `src/lib/rec-page.ts`; `src/app/api/recommendations/removed/route.ts`; `WhyPanel` in `src/app/components/RecCard.tsx`; migration 0035 | F5 → F3 → F1 → F2 → F4 → F6 → F7 → **P1-G** | ~14 days |
| **S — Screens** | Shahar (A1) | `src/modules/session/ratings/**`, the Watchlist parts of `RecommendationsView.tsx` (end card, card page), `src/modules/session/components/WTWApp.tsx`, `src/app/components/TabBar.tsx`, `src/app/search/**` (screens) | W1 → N1 → N2 → S1 → S2 → S3 → S4 → Q1 → Q2 → Q3 → **P2-G** | ~18 days |
| **A — Engine and server** | Alon (A2) | `src/modules/engine/**` (new: score one title), `src/app/api/recommendations/explain/route.ts`, `src/app/api/search/route.ts`, `src/app/you/**`, `src/app/api/feedback/**` (new), `src/app/api/account/**` (new), migrations 0036–0037 | M1 → Q4 → M2 → Y1 → Y2 → Y3 → Q6 → Q5 → L1 | ~16 days |

\*Effort means one person working with Claude Code. S ≤ 1 day, M = 2–4 days, L = 5+ days. Guesses, not commitments.

**Critical path:** F1 → F2 → F4 → P1-G → L-G, and M1 → M2 / Q5. Everything in phase 2 can be built while phase 1 runs.

```
week 1:  F: F5 F3 ── F1 (the 20 + Refresh)      S: W1 ── N1 Back ── N2 tabs     A: M1 score one title ── Q4 search index
week 2:  F: F2 ── F4 resting (Alon reviews)      S: S1 ── S2 ── S3 Seen          A: M2 fresh breakdowns ── Y1 ── Y2 feedback
week 3:  F: F6 F7 ── P1-G                        S: S4 ── Q1 ── Q2 ── Q3          A: Y3 delete ── Q6 ── Q5 ── L1
week 4:  P2-G ── launch checklist ── L-G (friends)
```

**Why the split looks like this** (Eran, 2026-11-18):
- **Eran takes For you,** the screen people see most. It's where the decisions were made, and it needs a designer's eye.
- **Shahar takes the screens and the larger share.** Seen, Search's screens, Back and tabs are precision work, in his own module
  (A1: `src/modules/session/`). The Watchlist's end card is his already (`WATCHLIST.md` DEC-9).
- **Alon is never idle.** M1 and Q4 need nothing from anyone, so he starts both on day one. M1 is the one engine piece that four
  things need: Search's match, fresh breakdowns on the Watchlist and Seen, and later the shared title page. The rest of his lane
  is server work with clear edges: the feedback email, Account and delete, and the JustWatch credit.

### 3a. Who does what (Eran, 2026-11-18)

The issues are assigned to match. Eran = `eran-manor` (A3), Shahar = `BloodyDeathRoll` (A1), Alon = `booster212` (A2).

| | Phase 1 — in this order | Phase 2 — in this order | Launch |
|---|---|---|---|
| **Eran** (~14 days) | F5 "Sharper picks" orange → F3 Hide → F1 the 20 + Refresh → F2 stamps until Refresh → F4 resting → F6 honest Creators → F7 stretch label → **drives P1-G** | Reviews Q6 (DNA write) | **Drives L-G** |
| **Shahar** (~18 days) | W1 Watchlist end card → N1 Back → N2 tabs remember | S1 Seen list → S2 rate on the row → S3 card page from Seen → S4 Hidden from For you → Q1 Search opens the card page → Q2 your mark on results → Q3 recent searches → **drives P2-G** | — |
| **Alon** (~16 days) | M1 score one title on request → M2 fresh breakdowns; reviews F4 | Q4 results from two letters (built in week 1, behind its flag) → Y1 You's bottom + Account → Y2 feedback → Y3 delete my account → Q6 a save from Search teaches taste → Q5 match on Search's card page | L1 JustWatch credit |

**Reviews on two-domain tasks:**
- Alon reviews F4 (it changes what the engine draws from).
- Eran reviews Q6 (a DNA write, A3).
- Shahar reviews Q5 (Alon's ring on Shahar's Search card page) and Y1 (the You page's look).

**Gates:**
- P1-G: Eran drives; Alon supplies the "Why" numbers; Shahar walks Back on his phone.
- P2-G: Shahar drives; Alon supplies the Search numbers.
- L-G: Eran.

---

## 4. Work packages

The format of each entry: **ID · title** — owner · lane · size · deps · flag. 🖼 = has a screen: the `ui-signoff` rule in §0
applies.

### Phase 1 — steady and honest

**F1 · The 20, with Refresh** — Eran · F · L · deps: none · `FOR_YOU_V3` · 🖼
> **In plain words:** For you shows about 20 picks that stay exactly as they are until you tap Refresh, at the top or on the end
> card. No "Find more", no endless scroll, nothing moves by itself.

- **Spec:** `FOR-YOU.md` DEC-1, DEC-2, DEC-3. **Approved screens:** `docs/prototypes/for-you-v3/9-refresh-at-the-end.jpg`,
  `10-refresh-at-the-top.jpg`.
- **Strings, exactly:** "Your 20 picks" · "Refresh" · "That's your 20 picks" · "Want 20 fresh ones? Or tell me what you're in the
  mood for, and I'll look for it." · "Tell me what you want".
- **How:**
  - The 20 are fixed when made (titles, order) and kept server-side per user until Refresh, so leaving and coming back, or another
    device, shows the same 20. Today's 6-hour cache and `next_offset` paging stay for the flag-off path.
  - Refresh = build a new 20 with all ratings so far (today's "Find more" path, which already rebuilds), then apply DEC-3.
  - The top line and the end card scroll with the list.
  - The chat button shows only when `chatMode() === 'consultant'` and the person has turns left today. Otherwise the end card
    shows Refresh alone, and the text drops its second sentence.
- **Done when:** with the flag on, leaving and coming back (tab hop, closing the app, a new day) shows the same 20 in the same order;
  Refresh brings a new 20 no slower than today's "Find more"; flag off, today's feed is unchanged. Screens match the JPEGs.

**F2 · What you did stays on the card until Refresh** — Eran · F · S · deps: F1 · `FOR_YOU_V3` · 🖼
> **In plain words:** a card you saved or rated stays where it is, showing what you did, until you refresh. A tab hop no longer
> makes it vanish.

- **Spec:** `FOR-YOU.md` DEC-4. **Approved screen:** `1-during-a-visit.jpg`.
- **Strings:** "Remove from watchlist" (yellow, as today) · "Saved to Seen" (replaces "Saved to Ratings", DEC-8).
- **Done when:** save, rate, hop to Watchlist and back: both cards still there and lit; un-save and un-rate both work from the
  card; the next Refresh drops both.

**F3 · Hide replaces the X** — Eran · F · M · deps: none · `FOR_YOU_V3` · 🖼
> **In plain words:** the X becomes a "Hide" button, and the card folds into a note that says what happened, with Undo. Hiding
> never touches your taste; it never did, and now the screen says so.

- **Spec:** `FOR-YOU.md` DEC-5. **Approved screen:** `2-hide.jpg`.
- **Strings:** "Hide" · "Hidden. You won't see **‹title›** again." · "Your taste isn't changed." · "Undo".
- **How:** keep writing `removed_titles` as today (`/api/recommendations/removed`). Undo calls its delete. The note stays until
  the next Refresh (unlike the Watchlist's 5-second note, the card's place stays visible in the 20).
- **Done when:** Hide, Undo, Hide again all land in `removed_titles` correctly; a unit test proves the DNA is byte for byte the
  same before and after Hide + Undo; the hidden title appears in Seen's Hidden list once S4 lands.

**F4 · Cards you stopped on rest, then retire** — Eran · F · M · deps: F1 · `FOR_YOU_V3` · Alon reviews
> **In plain words:** a card you actually looked at and skipped is held back for about a week, comes back lower down, then for
> about a month, then not again. Cards you flicked past don't count.

- **Spec:** `FOR-YOU.md` DEC-6, and the explainer `4-scrolled-past.jpg` (no new screen).
- **How:**
  - **Client:** an `IntersectionObserver` reports "stopped on" (≥ 50% visible for ≥ 1 s) once per card per 20.
  - **Server:** migration **0035** adds to `served_titles` what DEC-6 needs (times stopped on and skipped, `rest_until`), and
    `record_served_titles` (or a new RPC) writes it at Refresh.
  - **Candidate draw:** titles resting are left out until `rest_until`. A returning title is placed below the first five. After the
    third skip it's retired. This replaces the "seen 20%" share in `rec-page.ts` / `step1-candidate-gen.ts` (step 1 is A2's:
    Alon reviews).
- **Done when:** unit tests cover stopped vs flicked, the two rests, the retirement, and that any add, rate or hide ends it.
  Retest R1 shows no added, rated or hidden title returning (today 7 of 51 saves came back).

**F5 · "Sharper picks" gets the orange button** — Eran · F · S · deps: none · no flag · 🖼
> **In plain words:** the one blue button left on For you turns orange, like every other main button.

- **Spec:** `FOR-YOU.md` DEC-7. **Screen:** `6-sharper-picks-today.jpg` shows today's card; only `browseBtn` →
  `watchlistBtnPrimary` changes. Copy unchanged.

**F6 · "Why it's a match": the Creators bar tells the truth** — Eran · F · S · deps: none · no flag · 🖼 · **Mock first**
> **In plain words:** when someone you rated is in the title, the sheet names them; when nobody is, there's no bar and no number,
> just "Nobody you've rated is in this one." Creators moves to the bottom.

- **Spec:** `FOR-YOU.md` DEC-8. `WhyPanel` in `src/app/components/RecCard.tsx` (`crewScore`), used by For you's sheet and every
  card page.
- **Strings:** "Nobody you've rated is in this one." · the naming line's pattern, settled in the mock.
- **Done when:** on a live batch of 50, no card shows a Creators number with nobody rated in it (today 29 of 50).

**F7 · The stretch pick says it's a stretch** — Eran · F · S · deps: none · no flag · 🖼 · **Mock first**
> **In plain words:** the one-in-twenty pick that's outside your taste on purpose gets a small label, so it reads as a choice,
> not a bad match.

- **Spec:** `FOR-YOU.md` DEC-10, Q-3. Reads `is_stretch_pick` (already on every result).

**M1 · Score one title on request** — Alon · A · M · deps: none · no flag (new endpoint, nothing calls it yet)
> **In plain words:** the engine can score any catalogue title for one person on its own, outside a batch, and explain the score.
> It's the missing piece behind Search's match, fresh breakdowns on saved titles, and later the shared page.

- **How:** a server function in `src/modules/engine/` that runs steps 2 and 6 for one title against the user's current profile
  and taste model (formula v2), and returns the match (capped at 97, v2 DEC-10) and the same breakdown shape `/explain` returns.
  Expose it through `/api/recommendations/explain` (title key in, breakdown out) or a sibling route. Titles outside the catalogue
  answer "not scored", never a guess.
- **Done when:** for 20 titles from a live batch, the on-request match equals the batch's within 1 point; p95 under 1 s on
  production; unit tests for "not in catalogue" and "cold start".

**M2 · Breakdowns are always today's** — Alon · A · S · deps: M1 · no flag · touches Shahar's card page (says so in the PR)
> **In plain words:** a saved title's card page asks for a fresh breakdown instead of showing the one frozen on the day you saved
> it. No more old guessed bars, no more "not ready".

- **Spec:** `FOR-YOU.md` DEC-9; the card page as approved in `watchlist-v3/11-why-on-card.jpg` (unchanged).
- **How:** the card page (Watchlist now, Seen and Search later) calls M1. On failure it falls back to the saved snapshot, then to
  Why + Crew only (`WATCHLIST.md` DEC-2), never to an error line.
- **Done when:** on all 88 of our saved titles, 0 show the old guessed bars and 0 show an error (today 22 and up to 30).

**N1 · The phone's Back retraces your steps** — Shahar · S · M · deps: none · `NAV_HISTORY` 
> **In plain words:** Back undoes your steps inside WTW, then goes to For you, and only then leaves the app.

- **Spec:** `YOU.md` DEC-1. No new screen.
- **How:** each tab or stage switch in `WTWApp.tsx` and `TabBar.tsx` pushes a history entry; `popstate` restores the stage. Back
  from the chat returns to where it was opened. Sheets and Search keep today's rule (Back closes them).
- **Done when:** a written walk (every path in DEC-1) passes on Android Chrome, both in the browser and installed; flag off,
  today's Back is unchanged.

**N2 · Every tab remembers where you were** — Shahar · S · M · deps: N1 · `NAV_HISTORY`
> **In plain words:** leave a tab and come back to the same place, scrolled where you left it. Tapping the tab you're on still
> goes to the top.

- **Spec:** `YOU.md` DEC-2. For you's *list* staying put is F1 (Eran); this WP is the scroll position for every tab. Agree the
  seam with Eran before starting.

**W1 · The Watchlist's end card** — Shahar · S · S · deps: none · no flag · 🖼
> **In plain words:** at the end of your Watchlist, one card invites you to talk it over in the chat, which opens knowing where
> you came from.

- **Spec:** `WATCHLIST.md` DEC-9. **Approved screen:** `docs/prototypes/watchlist-v3/10-end.jpg`. Classes `nudge`,
  `nudgeEyebrow`, `nudgeText`, `watchlistBtnPrimary`.
- **Strings (placeholder, Eran approves at the PR):** "Need help deciding? Let's talk it over." · "Let's talk" · chat opener:
  "Want to talk about what's on your list, or something new?"
- **Rule:** shown only under All, with three or more unseen titles, and only when the chat is on and has turns left (as F1).

### Phase 2 — Seen, Search, You

**S1 · Seen in Watchlist rows** — Shahar · S · M · deps: none · `SEEN_V3` · 🖼
> **In plain words:** Seen gets posters and the Watchlist's rows, chips for Loved / Liked / Disliked / Hidden from For you, and
> today's two dropdowns.

- **Spec:** `SEEN.md` DEC-1, DEC-2, DEC-3, DEC-9. **Approved screens:** `docs/prototypes/seen-v3/7-icons.jpg` (the final shape;
  where 1–6 differ, 7 wins), `1-shape.jpg` right, `2-filter.jpg` right, `6-empty.jpg`.
- **Strings:** "Seen (N)" · "Nothing here yet. Tap Loved, Liked or Disliked on any title you've seen and it lands here." · "Go to
  For you" · "Nothing disliked yet." (and its siblings).
- **How:** reuse the Watchlist row component from #345; the big count and the four tiles go. Flag off = today's `RatingsView`.

**S2 · Change a rating right on the row** — Shahar · S · M · deps: S1 · `SEEN_V3` · 🖼
> **In plain words:** each row has ❤️ 👍 👎; tap another and the gold moves at once, the row stays, and a note says where it will
> go, with Undo.

- **Spec:** `SEEN.md` DEC-4, DEC-5. **Approved screen:** `7-icons.jpg`.
- **Strings:** "**‹title›** will move to Liked." (Loved / Disliked) · "Undo".
- **Rules:** tapping the lit icon does nothing; the row leaves its chip the next time that chip opens; the counts change at once.

**S3 · The card page from Seen, and clearing a rating** — Shahar · S · M · deps: S1 · `SEEN_V3` · 🖼
> **In plain words:** tap a row and the same card page opens, with your reaction lit; tap it again to clear the rating, with a
> note and Undo back on Seen. "Saved to Ratings" becomes "Saved to Seen" everywhere.

- **Spec:** `SEEN.md` DEC-6, DEC-7; plan DEC-8. **Approved screens:** `3-tap.jpg`, `4-clear.jpg`.
- **Strings:** "Saved to Seen" · "Rating cleared. **‹title›** is out of Seen, and your taste forgets it." · "Undo".
- **Shared file:** "Saved to Seen" also lives on For you's card (`RecommendationsView.tsx`): one open PR at a time (§8); F2 may
  land it first.

**S4 · Hidden from For you, with Restore** — Shahar · S · S · deps: S1, F3 · `SEEN_V3` · 🖼
> **In plain words:** titles you hid on For you are listed under their own chip, each with Restore and Undo.

- **Spec:** `SEEN.md` DEC-8. **Approved screens:** `5-hidden.jpg` (middle and right; the entry is the chip, not 5's quiet row).
- **Strings:** "You hid these on For you, so they never come back there. Restore one and it can." · "Restore" · "Restored.
  **‹title›** can show up on For you again." · "Undo".

**Q1 · Every title in Search opens the card page** — Shahar · S · M · deps: none (M1 for the ring, which Q5 adds) · `SEARCH_V3` · 🖼
> **In plain words:** whatever you tap in Search (a result, a title on someone's page, your own titles on top) opens the same card
> page as everywhere else, in that title's state for you: save, rate, where to watch, share, trailer.

- **Spec:** `SEARCH.md` DEC-2, DEC-8, DEC-9. **Approved screens:** the card page as in `watchlist-v3/5-tap.jpg` and
  `seen-v3/3-tap.jpg`; Search's list itself is unchanged.
- **Strings:** "In Seen" (replaces "In your ratings").
- **Done when:** a rating from Search lands in Seen and the taste profile (`SEARCH.md` DEC-4); Back walks card → person → list →
  where you came from.

**Q2 · Each result shows where it stands with you** — Shahar · S · S · deps: Q1 · `SEARCH_V3` · 🖼 · **Mock first**
> **In plain words:** a result's third line starts with your mark (❤️ Loved, 👍 Liked, 👎 Disliked, In your Watchlist, Hidden
> from For you), then the actors when there's room.

- **Spec:** `SEARCH.md` DEC-5. No JPEG exists yet: mock the row (with and without a mark, long and short titles) for Eran's OK.

**Q3 · Recent searches fill the empty box** — Shahar · S · S · deps: none · `SEARCH_V3` · 🖼 · **Mock first**
> **In plain words:** before you type, your last six or so searches wait under the box, newest first, with Clear. Kept on this
> phone only.

- **Spec:** `SEARCH.md` DEC-7. Stored in `localStorage` (wrapped in try/catch), never sent to us. No JPEG yet: mock it first.

**Q4 · Results from the second or third letter** — Alon · A · M · deps: none · `SEARCH_V3` · migration 0036
> **In plain words:** typing "sl" already offers Slow Horses, and a one-word typo like "godfahter" still finds The Godfather.

- **Spec:** `SEARCH.md` DEC-6.
- **How:** migration **0036** adds a trigram index on `titles.title` (`pg_trgm`). `/api/search` matches word starts and close
  spellings in our catalogue, merges with TMDB's whole-word answers, best-known first, no doubles, up to six. Not from the first
  letter.
- **Done when:** "sl" → Slow Horses in the six; "godfahter" → The Godfather; the catalogue lookup under 150 ms on production (today
  7.3 s without the index); flag off, today's search unchanged.

**Q5 · Your match on Search's card page** — Alon · A · S · deps: M1, Q1 · `SEARCH_V3` · 🖼 · Shahar reviews
> **In plain words:** a catalogue title opened from Search shows your match ring and breakdown about a second after the card;
> a title outside the catalogue shows neither.

- **Spec:** `SEARCH.md` DEC-3; plan DEC-5. The card shows at once, and the ring fills in when M1 answers.

**Q6 · Saving from Search teaches your taste** — Alon · A · S · deps: Q1 · `SEARCH_V3` · Eran reviews (A3)
> **In plain words:** adding to the Watchlist from Search counts the same as a save from For you.

- **Spec:** `SEARCH.md` DEC-4 (Eran, 2026-11-04). Use the same path the For you save uses; DNA rules apply (patch, bump
  `taste_version`, `docs/DNA-CONTRACT.md`).

**Y1 · You's bottom, and the Account page** — Alon · A · S · deps: none · no flag · 🖼 · Shahar reviews
> **In plain words:** You ends with "Send us feedback" and "Account ›". Account is its own page with Start my taste over, Sign
> out and Delete my account. The header says "30 ratings", not "30 ratings · 12 picks".

- **Spec:** `YOU.md` DEC-3, DEC-4. **Approved screens:** `docs/prototypes/you-v3/1-account-row.jpg`, `2-account-page.jpg`.
- **Note:** the Delete row is added by Y3. Until then, Account has two rows.

**Y2 · Send us feedback** — Alon · A · M · deps: Y1, and the Resend account (Eran opens it) · no flag · 🖼 · migration 0037
> **In plain words:** a page with a text box; Send emails the note to the team's inbox, and Reply in Gmail answers the sender.
> Nothing typed is ever lost.

- **Spec:** `YOU.md` DEC-5, which lists every step (Resend, two secrets, the `feedback` table, `POST /api/feedback`, the hourly
  limit, the nightly retry, the page, what "done" means). **Approved screens:** `3-feedback.jpg`, `4-feedback-sent.jpg`.
- **Migration:** **0037** (DEC-5 says 0034; that number went to the Watchlist's star).

**Y3 · Delete my account** — Alon · A · M · deps: Y1 · no flag · 🖼 · **Mock first** (the confirm sheet)
> **In plain words:** the last row on Account deletes your account and everything we hold about you, after one clear question.

- **Spec:** `YOU.md` DEC-3. The sheet takes the Start-over sheet's look, Cancel is the big orange button; its text is a draft:
  mock it for Eran's OK.
- **How:** a server route (`src/app/api/account/delete/`) that erases every user-owned row (list them in the PR, table by table)
  and the auth user, with the service role. Feedback rows go with the foreign key (Y2).
- **Done when:** on a *truly new* test account (v2 lesson, §8), every user table holds zero rows for it afterwards, and the same
  email can sign up fresh.

### Launch

**L1 · The JustWatch credit comes back** — Alon · A · S · deps: none · no flag · 🖼 · **Mock first**
> **In plain words:** TMDB's terms require crediting JustWatch wherever we show where to watch. The credit was removed on
> 2026-08-29 and must be back before strangers use the app.

- **Spec:** `EVIDENCE.md` point 10. Where: the card, the card page, the Watchlist row's service. Mock the smallest honest
  credit for Eran's OK.

---

## 5. Retests

| # | What | When | Who |
|---|---|---|---|
| R1 | Re-run `EVIDENCE.md` §1 (repeats, cards with no reaction, saved titles coming back) on our three accounts | Two weeks after `FOR_YOU_V3` is on; again before L-G | The coordinator session (the scripts are local, `docs/prototypes/next-round-evidence/`) |
| R2 | Re-run §2 ("Why"): Creators with nobody rated; Watchlist breakdowns | After F6 and M2 | The coordinator session |
| R3 | Search: "sl", "se", "godfahter", "shtisle", 10 titles in and out of the catalogue | After Q4 and Q5 | Alon |

### Gates

**P1-G · Phase 1 is on for everyone** — Eran drives.
1. **No comebacks** (R1): no title that was added, rated or hidden is shown again, and no resting title returns inside its rest
   (today 7 of 51 saves came back).
2. **Hide never changes taste:** F3's test passes.
3. **True "Why"s** (R2): 0 of 50 cards show a Creators number with nobody rated; 0 of our saved titles show old guessed bars or an
   error.
4. **Back** (Shahar): the N1 walk passes on Android Chrome, in the browser and installed.
5. **Screens:** Eran walks every phase 1 state on his phone against its JPEG.
6. `npm run type-check` and `npm test` clean; today's screens walked with every flag off and on.

**P2-G · Phase 2 is on for everyone** — Shahar drives, Alon supplies R3.
1. **Seen:** move a rating on the row, Undo, clear from the card page, Restore a hidden title: counts right every time.
2. **Search** (R3): "sl" finds Slow Horses; "godfahter" finds The Godfather; every tapped title opens the card page; the ring only
   on catalogue titles, under 1 s.
3. **Taste:** a rating or a save from Search reaches the profile (`taste_version` goes up).
4. **Feedback:** a note from the live app is in the inbox within a minute; Reply reaches the sender; a sixth note in an hour is
   refused.
5. **Delete:** Y3's "done" on a truly new account.
6. **Screens:** Eran walks every phase 2 state against its JPEG.

**L-G · Friends launch** — Eran. The §6 checklist, all ticked.

---

## 6. Friends launch checklist

- [ ] P1-G and P2-G passed.
- [ ] L1: the JustWatch credit is back.
- [ ] F7: the stretch pick is labelled.
- [ ] Feedback works from production (Y2) and Delete works (Y3).
- [ ] **The chat's daily budget.** Today: 10 turns a person, 20 for everyone together (`CHAT.md`). The end cards hide the chat
      button when it's out of turns (F1, W1). Decide whether that's enough for the number of friends invited (Eran).
- [ ] Sign-up: open or invite-only (Eran).
- [ ] A truly new account goes from sign-up to a feed, on Android Chrome, installed and in the browser.

---

## 7. Not in this round

- **The chat's next step** (`CHAT.md`, parked for v4): its role, then its budget, then design.
- **Games and the brain** (Eran).
- **Parked inside the parts:** the Watchlist's sort (`WATCHLIST.md` §P); Install WTW and Privacy · Terms on You (`YOU.md` §P);
  finding a title from a description (`SEARCH.md` §P); your match on the shared title page (backlog 2026-11-03; M1 makes it cheap,
  so it's the first thing for v4).

---

## 8. Conventions

- **Flags** live in `src/lib/flags.ts` (add a function per flag, like `navTabsEnabled()`). v3 adds `FOR_YOU_V3`, `NAV_HISTORY`,
  `SEEN_V3`, `SEARCH_V3`.
  - The default is today's behaviour.
  - Set flags in Vercel and in `.env.local`. Some flags are inlined at build, so a change needs a redeploy (v2 lesson).
  - Switching a flag on is a gate, not a WP.
- **Migrations:** `0035` (F4), `0036` (Q4), `0037` (Y2) are reserved.
  - Claim any other number on your issue before writing it.
  - Run it with `SUPABASE_DB_URL` + `pg` (INTEGRATION.md) and verify it live **before** merging code that needs it.
- **Hot files: one open PR at a time, and say on the issue when you start.**
  - `src/modules/session/recommendations/RecommendationsView.tsx` (+ `.module.css`): Eran (F*), Shahar (W1, S3, Q1).
  - `src/modules/session/components/WTWApp.tsx`: Shahar (N1, N2); Eran (F1) only for the stage seam.
  - `src/app/components/RecCard.tsx` (`WhyPanel`): Eran (F6); Alon (M2) only for where the data comes from.
  - `src/app/search/SearchView.tsx`: Shahar (Q1–Q3); Alon (Q5) only for the ring.
  - `src/lib/flags.ts`: anyone, a one-function change, rebase before merging.
  - `src/types/dna.ts`: nobody (DEC-11).
- **Screens:** the `ui-signoff` rule in §0. The mock pipeline is `docs/prototypes/watchlist-v3/build.py` + `render.py`.
- **Models:** model ids live only in `src/lib/ai-models.ts`. Never test on Groq `MODELS.text`: it's the chat's model and its free
  budget is shared (200k tokens a day).
- **Before every PR:** `nvm use`, then `npm run type-check` and `npm test`.
- **Lessons from running v2:**
  - Test on a *truly* new account, not a reset one. A reset account kept a profile and hid the "dna is null" bug (#333).
  - Next.js doesn't prefetch in dev. Check speed work on a production build.
  - Vercel Hobby deploys go through the CLI upload with no `.git` (#331), because commit authors got blocked.
  - Gates name who runs what, so the last gate doesn't stall.
  - GitHub CI can be blocked by the account's billing (seen on #345). Then run `npm run type-check` and `npm test` yourself and
    paste the result in the PR.
- **Privacy — the repo is public. Never commit:** `.env.local`; testers' answers, play events or DNA; user ids next to ratings;
  emails other than the team feedback address; the evidence scripts in `docs/prototypes/next-round-evidence/`.
- **DNA writes:** patch fields, never overwrite the whole schema; bump `metadata.taste_version` and `last_updated`
  (`docs/DNA-CONTRACT.md`).

---

## 9. Open questions — Eran decides

| # | Question | When |
|---|---|---|
| Q-1 | The rest times (a week, a month) | Two weeks after F4 is on (R1) |
| Q-2 | A hint on a 20 left alone for days | After P1-G |
| Q-3 | The stretch label's words | F7's mock |
| Q-4 | The Watchlist end card's copy | W1's PR |
| Q-5 | Delete my account's sheet text | Y3's mock |
| Q-6 | Chat budget, and open or invite-only sign-up, for friends | Before L-G |

---

## 10. Code map

| Thing | Where |
|---|---|
| For you and the Watchlist (one view, two modes) | `src/modules/session/recommendations/RecommendationsView.tsx` (`FeedCard`, `CalibrateNudge`, the card page, `NUDGE_EVERY = 15`, `WATCHLIST_PAGE_SIZE = 6`) |
| Stages and tabs | `src/modules/session/components/WTWApp.tsx`, `src/app/components/TabBar.tsx` (`navTabsEnabled()`) |
| The feed's pages and what was shown | `src/lib/rec-page.ts` (`record_served_titles`, the "seen 20%"), `served_titles` (migrations 0019, 0032) |
| Hide / the X | `src/app/api/recommendations/removed/route.ts` → `removed_titles`; read only as an exclusion in `step1-candidate-gen.ts` and `cold-start.ts` (`precompute.ts` leaves it out on purpose) |
| "Why it's a match" | `WhyPanel` in `src/app/components/RecCard.tsx`; `/api/recommendations/explain`, `/why`, `/why-lines`; engine `pipeline/step6-reason-payload.ts`, `step7-card-reason.ts`, `src/modules/engine/why/*` |
| Stretch pick | `pipeline/step5-stretch-pick.ts`; `is_stretch_pick` on each result (`src/types/dna.ts`) |
| Saved titles | `src/lib/watchlist.ts`, `/api/watchlist` (the saved "Why" snapshot) |
| Seen today | `src/modules/session/ratings/RatingsView.tsx`, `GET /api/recommendations/ratings` |
| Search | `src/app/search/SearchView.tsx`, `GET /api/search` (+ `/cast`, `/person`, `/title`) |
| You | `src/app/you/page.tsx`, `YouCards.tsx`, `you.module.css` |
| Flags | `src/lib/flags.ts` |
| Chat | `src/app/api/conversation/message/` (`context.ts`, `grounding.ts`, `watchlist.ts`), `chatMode()` |
| Tests | `tests/unit/*.test.ts` (vitest), `tests/component`, `tests/e2e` |
