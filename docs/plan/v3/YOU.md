# Tab bar and You for the next round: decisions and open questions

Started 2026-11-18, with Eran, the same way as For you and the Watchlist (`WATCHLIST.md` is the model).
Mocks: `docs/prototypes/you-v3/`.

**Status: decided with Eran, 2026-11-18.**

## 0 · Today (from the code; the tab bar is live in production)

**The bar** (`src/app/components/TabBar.tsx`): For you · Watchlist · Games · You, 56px, near-black at 90%, the selected tab
white. The Watchlist tab carries a count (the whole list). Tapping the tab you're on scrolls that screen to the top. Hidden
while the keyboard is up. Shown on For you, Watchlist, the Games lobby, You, My taste and Seen; not in the chat, Search, a game,
or the onboarding. The chat bubble sits top left on every tab, search top right.

**Moving around.** For you, Watchlist, Seen and the chat are stages of one page (`WTWApp.tsx`); Games and You are pages of
their own. Switching stages adds no step to the browser's history, so the phone's Back from the Watchlist or the chat leaves
WTW. Back from You or Games lands on `/`, which always opens on For you. Leaving a tab forgets where you were scrolled. The
"Why it's a match" sheet and Search already handle Back (they close).

**You** (`src/app/you/`): your name, "N ratings · N picks" (picks = the onboarding's this-or-that choices); How WTW sees you
(summary + 3 scales), People who pull you in (2 per group), Genres in your feed (3 rows), each with "See all N" into My taste;
Seen (counts + newest posters, "See all" → the ratings page, titled Seen); Account (Sign out, Start my taste over). No
feedback, no delete, no install, no Privacy · Terms (the pages exist at `/privacy` and `/terms`).

## R · What other apps do (2026-11-18), and what it means for us

- **Android's own guidance and YouTube:** Back retraces your steps; from another tab's top it goes to the home tab, and only
  Back on the home tab leaves the app. A web app has to build this itself: each tab switch must add a step to history.
- **Instagram, Spotify, YouTube, WhatsApp:** every tab keeps your place; tapping the tab you're on is how you get to the top.
- **Netflix's "My Netflix" tab, Letterboxd's profile:** "you" is where your own things live (your list, what you liked); settings
  sit quietly one level down. Instagram and Spotify keep Log out one tap deep, at the bottom of settings.
- **Google Play:** an app that lets people create an account must let them delete it, in the app and through a web link
  (support.google.com/googleplay/android-developer/answer/13327111). We're a web app, so it doesn't bind us yet; it's the
  decent thing to do once strangers' data is in the database.
- **Installing a web app (web.dev, "Patterns for promoting PWA installation"):** offer it calmly from a menu or settings row,
  never as a pop-up. Left out for now (DEC-3).

**What it means:** the bar itself is right; what's missing is the way it behaves when you move around (Back, your place), and
the plain grown-up things a stranger expects to find under "you" (a way to talk to us, a way to leave).

## DEC · Decided

- **DEC-1 · The phone's Back retraces your steps, then For you, then out.** Android's Back (the edge swipe, ◁, or Chrome's
  Back arrow; the same thing) first undoes the steps you took inside WTW. At the top of Watchlist, Games or You it goes to
  For you; on For you it leaves WTW. Back from the chat returns to the screen it was opened from. Sheets and Search keep
  today's rule (Back closes them). Today, Back from the Watchlist or the chat leaves WTW, because switching to them adds no
  step to the browser's history. (Eran, 2026-11-18)
- **DEC-2 · Every tab remembers where you were.** Leave a tab and come back: you land where you left it, scrolled to the same
  place (Instagram, YouTube, Spotify, WhatsApp). Tapping the tab you are on still goes to the top, as today. For you's list itself
  stays put until Refresh (For you's plan); this adds the scroll position. (Eran, 2026-11-18)
- **DEC-3 · Feedback in the open, Account one tap deeper.** The bottom of You ends with one card of two rows, in the genre
  rows' look: "Send us feedback" (out in the open so friends find it), then "Account ›". Account opens its own page (Back
  returns to You, the You tab stays lit) with three rows: Start my taste over (today's row and sheet), Sign out (no arrow; it
  acts at once), Delete my account (last, in the app's red #ff8a7a). Delete asks first in the Start-over sheet's look, Cancel
  the big orange button; the sheet's text is a draft. No Install WTW and no Privacy · Terms for now. (Eran, 2026-11-18)
  [1-account-row, 2-account-page]
- **DEC-4 · "30 ratings", not "30 ratings · 12 picks".** The "picks" were the onboarding's this-or-that choices; For you's
  plan calls the feed "Your 20 picks", so the same word would mean two things. You's header (and My taste's) says the
  ratings count only, which matches Seen's "See all 30". (Eran left it to Claude, 2026-11-18)
- Tab bar on in production already (Eran, 2026-11-18). The Games tab stays as it is; Games is out of this round.
- **DEC-5 · "Send us feedback" opens a page with a text box; Send emails the note to whattowatchfeedback26@gmail.com.**
  It never opens the phone's email app. This was Q-1. (Eran, 2026-11-18; page rather than a pop-up: Eran and Claude agreed. A
  page gives the text box and the keyboard room, and it matches Account.) [3-feedback, 4-feedback-sent]

  **What you see.**
  - The page has its own address under You, like Account (`/you/feedback`). Back (top left) returns to You, and the You tab
    stays lit.
  - Title "Send us feedback". One line: "Tell us what to fix, or what you'd love to see. It goes straight to the team, and we read
    every note."
  - **The text box:** in the chat input's look (`.inputbar` in `WTWApp.module.css`: #161614, the yellow glow while you type),
    with rounded corners (20px) since it's several lines. Placeholder "Write your note here".
    - **Height:** about 260px, 30% taller than the mocks draw it (Eran, 2026-11-18). No new mock.
    - Text 16px (so the phone doesn't zoom in). It stops taking text at 2,000 characters.
  - A quiet line under it: "Sent with your email address, so we can reply."
  - **Send:** the app's orange button (You's `.sheetCta`), dimmed until there's text. It sits right under the box, so the
    keyboard never covers it. The tab bar hides behind the keyboard, as today.
  - **Sending:** the button says "Sending…" and can't be tapped twice.
  - **Sent:** the page says "Thanks, it's with the team." and "If it needs an answer, we'll reply by email.", with a dark "Back
    to You" button (`.sheetOpt`). The text box is gone.
  - **If it fails:** the note stays in the box, and a red line (#ff8a7a) says "Couldn't send it. Your note is still here; try
    again in a moment." Send works again. Nothing typed is ever lost.

  **What has to be built so it reaches the inbox** (everything the builder needs; Shahar or Alon, Eran, 2026-11-18).
  1. **Open a free Resend account** (resend.com) signed up *with whattowatchfeedback26@gmail.com itself*.
     - The builder needs to get into that Gmail inbox once, to confirm the sign-up. Ask Eran for access; never put its password
       in the repo or a chat.
     - Make one API key with "sending access" only.
     - Free plan: 100 emails a day, 3,000 a month (resend.com/docs/knowledge-base/account-quotas-and-limits).
     - Without a website domain of our own, Resend only delivers to the address the account was opened with
       (resend.com/docs/knowledge-base/403-error-resend-dev-domain). That's exactly the one address we send to, so no domain is
       needed.
     - Resend calls its shared sender ("onboarding@resend.dev") a testing address. If it ever stops delivering, the fallback is
       sending from the Gmail account itself, with a Gmail "app password" (needs 2-Step Verification on that Gmail).
  2. **Two secrets**, in Vercel (Production) and each developer's `.env.local`:
     - `RESEND_API_KEY`
     - `FEEDBACK_TO=whattowatchfeedback26@gmail.com`

     Add both to the environment list in `CLAUDE.md`. If either is missing, the send step answers "unavailable" and the page
     shows the red line; it never crashes.
  3. **A database table `feedback`**, one migration (`supabase/migrations/0034_feedback.sql`, or the next free number).
     - Columns: `id`, `user_id` (references the user, deleted with them), `body` (text, 1–2,000 characters), `created_at`,
       `user_agent` (the phone and browser), `emailed_at` (empty until the email went out), `attempts` (number).
     - Row security on, with no policies for signed-in people. Only the server (service role) writes and reads it, so nobody can
       read anyone else's notes.
     - Every note is saved here first, so a failed email never loses it.
  4. **The send step: `POST /api/feedback`** (`src/app/api/feedback/route.ts`).
     - Signed-in only, checked the same way `/api/search` does (`getClaims`, `logAuthFailure`).
     - Takes `{ body }`, trimmed: at least 1 character, at most 2,000; otherwise it refuses.
     - **Limit:** at most 5 notes an hour per person, as a counter in Upstash Redis (`src/lib/redis.ts`), so a stuck button or a
       bad actor can't flood the inbox. Over the limit it refuses and the page shows the red line.
     - **Saves the row, then emails it** with one call to Resend's send address (`POST https://api.resend.com/emails`, a plain
       `fetch`; no new package needed):
       - From: `WTW feedback <onboarding@resend.dev>`; To: `FEEDBACK_TO`.
       - Reply-To: the sender's own email, so pressing Reply in Gmail answers them directly.
       - Subject: `WTW feedback from <their name>`, or their email when there's no name.
       - Body: the note in full, then their name, email, user id, date and time (Israel time), and phone and browser.
     - **Answers "sent" once the row is saved**, even if the email fails. Then it sets `emailed_at`, or leaves it empty and adds
       to `attempts`. Only a failed save, the hourly limit, or missing secrets show the red line.
  5. **Retry unsent notes nightly.** Rows with no `emailed_at` and fewer than 5 attempts get sent again, either from a new
     `/api/cron/feedback` (protected by `CRON_SECRET`, like `/api/cron/decay`, and added to `vercel.json`'s crons) or as a step
     at the end of decay's 04:00 run if the Vercel plan won't take a second job.
  6. **The page:** `src/app/you/feedback/page.tsx`, built like Account's page.
     - "Send us feedback" on You links to it (DEC-3).
     - Back follows DEC-1.
     - Nothing is kept on the phone after sending.
  7. **Delete my account** (DEC-3, when it's built) erases their `feedback` rows; the foreign key does it. Emails already in the
     inbox stay there; the page's line tells people their email goes with the note.
  8. **Done means:**
     - A note sent from the live app arrives in the inbox within a minute.
     - Reply in Gmail goes to the sender.
     - A sixth note in an hour is refused, with the red line.
     - With a wrong API key, the note is still saved and goes out on the next nightly run once the key is fixed.
     - `npm run type-check` is clean.

  **Owner:** Shahar or Alon (Eran, 2026-11-18). The You page and `src/app` are shared, so coordinate before touching.

## Q · Open

None.

## P · Parked

- **Install WTW** (a row on Account, only on phones that can install; Android Chrome's own prompt). Out for now (Eran).
- **Privacy · Terms** links. The pages exist (`/privacy`, `/terms`); not shown for now (Eran).

