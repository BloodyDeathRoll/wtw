# For you for the next round: decisions and open questions

Started 2026-11-16, with Eran. Numbers: `EVIDENCE.md` §1 (repeats, cards with no reaction) and §2 ("Why it's a match").
Mocks: `docs/prototypes/for-you-v3/` (real feed capture, real titles from TMDB). Built in Eran's lane (`PLAN.md` track F).

**Status: decided with Eran, 2026-11-18.** Open points are in §Q, each with an owner and a moment to decide.

## 0 · For you today (from the code, NAV_TABS on)

- **The list.** One batch of 50 is built (cached for 6 hours) and shown 6 cards at a time, with "Find more" at the end, which
  rebuilds the batch. Coming back to For you starts at the top again (`EVIDENCE.md` §1, point 3).
- **Repeats.** Of 3,454 titles ever shown, 45% were shown more than once; one was shown to Shahar 39 times. 60% of everything
  shown was never rated or removed. The cause: every batch draws 20% from "shown before, never touched" (`src/lib/rec-page.ts`,
  `served_titles`), and returning starts from the top.
- **Saved titles come back.** 7 of 51 Watchlist titles were later shown on For you again.
- **The X** (`handleRemove`) slides the card away with no Undo and writes `removed_titles`. That table only *excludes* the title
  (`step1-candidate-gen.ts`, `cold-start.ts`); it never reached the taste model (`precompute.ts` leaves it out on purpose). So
  Alon read the X as "this hurts my ratings" and Shahar as "never this title again": Shahar was right about what it did, and
  nothing on screen said so.
- **After a rating or a save** the card stays, lit; a tab hop rebuilds the list and the card is gone.
- **"Why it's a match".** On the feed the bars are real (50 of 50). But 29 of Eran's 50 cards have nobody he rated in them and the
  Creators bar still shows a number (*The Big Bang Theory*: 27%), which reads as "you like these people 27%".
- **The stretch pick** (1 in 20, outside your taste on purpose) carries `is_stretch_pick` but nothing on the card says so.
- **"Sharper picks"** (`CalibrateNudge`, every 15 cards for people who skipped part of the games) has a blue button, the only blue
  primary button on the screen.

## R · What others do, and what it means for us

- **Netflix** (Gomez-Uribe & Hunt, 2015): people give up after 60–90 seconds and 10–20 titles. A long list isn't more choice.
- **Twitter (2021) and Instagram (2024)** stopped refreshing the feed under people's thumbs ("the rug pull"). A list you were
  reading should not move by itself.
- **LinkedIn** (KDD 2014, impression discounting): something you were shown and passed over should come back less, not never.
- **YouTube** splits "Not interested" (this one) from "Don't recommend channel" (a rule). People must know which they pressed.
- **What2WatchAI** hides a card at once, says it "won't affect your taste profile", and offers Undo.
- **IAB viewability**: an ad counts as seen when half of it is on screen for one second. We borrow that line.

**What it means:** For you is a shop window, not an inbox. A short, steady set you can look through, that changes when you ask,
where every button says exactly what it does.

## DEC · Decided

- **DEC-1 · A set of 20 that stays put.** For you shows about 20 picks. They stay exactly as they are (same titles, same order,
  same stamps) until you tap Refresh: leave and come back, nothing moves. No endless scroll, no "Find more", no refresh by itself,
  no pull-down (in Chrome on Android a pull reloads the whole page, and an installed app doesn't get it at all). With `YOU.md`
  DEC-2, you also land at the same scroll position. [9-refresh-at-the-end, 10-refresh-at-the-top]
- **DEC-2 · Refresh in two places.**
  - **At the top:** a slim line "Your 20 picks" with a yellow text link "↻ Refresh" (the "Why it's a match" yellow). It scrolls
    away with the list and never covers a card.
  - **At the end, after card 20:** a card in the "Sharper picks" card's look (`nudge`, `nudgeEyebrow`, `nudgeText`). Eyebrow
    "That's your 20 picks". Text "Want 20 fresh ones? Or tell me what you're in the mood for, and I'll look for it." Buttons: the
    orange "↻ Refresh" (`watchlistBtnPrimary`), then a dark "Tell me what you want", with the chat icon, which opens the chat.
  - When the chat is off or out of turns for the day, the end card shows Refresh alone and the text's second sentence goes:
    the card never offers something that won't answer. [9-refresh-at-the-end, 10-refresh-at-the-top]
- **DEC-3 · What Refresh does.** A new 20, built with every rating made so far. Then:
  - added, rated or hidden titles are gone from For you for good;
  - titles you stopped on and didn't act on start resting (DEC-6);
  - titles you flicked past, or never reached, go back into the pool as if never shown.
  [10-refresh-at-the-top, right]
- **DEC-4 · What you did stays on the card until Refresh.** Add to Watchlist turns the button into the yellow "Remove from
  watchlist"; a rating lights its chip and the line says "Saved to Seen" (`SEEN.md` DEC-6 renames "Saved to Ratings"
  everywhere). Tap again to undo either. A tab hop doesn't remove anything. This replaces the backlog row of 2026-11-06 ("Adding a
  title takes it off right away"). [1-during-a-visit]
- **DEC-5 · "Hide" replaces the X.** A small pill with the eye-off icon and the word "Hide" where the X was. Tapping it folds the
  card into a one-line note: "Hidden. You won't see **‹title›** again." / "Your taste isn't changed." with Undo on the right; the
  next card moves up. It writes `removed_titles` exactly as today (exclusion only, never the taste model); Undo deletes the row.
  Hidden titles are listed, and can be restored, under Seen's "Hidden from For you" chip (`SEEN.md` DEC-8). [2-hide]
- **DEC-6 · Cards you stopped on rest, then retire.**
  - **Stopped on** = at least half the card on screen for at least one second (the IAB line). A fast flick doesn't count, and
    neither do cards below where you stopped.
  - Stopped on and not acted on: it rests about **a week**, comes back **lower down** (never in the top five), and if you pass it
    again it rests about **a month**, comes back one last time, and then **retires** from For you.
  - Adding, rating or hiding it at any point takes it off For you for good.
  - This replaces today's "20% of every batch is shown-before". The week and month are placeholders (§Q-1). [4-scrolled-past;
    in that image "scrolled past" means "stopped on and skipped"]
- **DEC-7 · "Sharper picks" keeps its place and copy, with the orange button.** No blue buttons anywhere (`WATCHLIST.md` DEC-10).
  [6-sharper-picks-today shows today's card; only the button's colour changes]
- **DEC-8 · "Why it's a match": the Creators bar tells the truth.** (Claude's proposal, Eran approved 2026-11-18.)
  - When someone you rated is in the title: name them under the bar, for example "Robert De Niro, you loved 3 of his".
  - When nobody is: no bar and no number, one quiet line instead: "Nobody you've rated is in this one."
  - Creators moves to the bottom of the Score breakdown (backlog 2026-11-05).
  - This is the shared `WhyPanel` (`src/app/components/RecCard.tsx`), so the Watchlist, Seen and Search card pages get it too.
- **DEC-9 · The breakdown is always today's.** A title's card page (Watchlist, Seen, Search) never shows a breakdown frozen on the
  day it was saved: it asks the engine for a fresh one (`PLAN.md` M1–M2, Alon). Today 22 of 88 saved titles show the old guessed
  bars and 30 show none.
- **DEC-10 · The stretch pick says it's a stretch.** A small label on the card, wording settled in its mock (§Q-3), so a pick
  outside your taste reads as a choice, not a bad match. Its accept/reject is already a taste signal (CLAUDE.md).

## Q · Open (owner, and when)

- **Q-1 · The rest times.** A week and a month are placeholders. Eran, after two weeks of real use with DEC-6 on (retest R1).
- **Q-2 · A set left alone for days.** Does a 20 untouched for, say, three days show a hint ("Refresh for fresh picks")? Eran,
  after phase 1 is live.
- **Q-3 · The stretch label's words and look.** Eran, as the first step of F7 (mock, then build).

## Superseded mocks (kept on Eran's machine, not in the repo)

3-next-visit ("tomorrow the top is new"), 5-end-of-the-day ("Show more"), 7-new-picks (the white pill), 8-check-in ("Show 20
more"). The set of 20 with Refresh replaced all four.
