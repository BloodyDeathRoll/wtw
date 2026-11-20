# The chat for the next round: parked

Started 2026-11-18, with Eran, as part 4 of the v3 planning. **Status: parked for v3 (Eran, 2026-11-18).** The chat stays as
it is this round, with no new work. This file records where it stands, so v4 starts from here, not from scratch.

## 0 · The chat today (from the code and `docs/INTEGRATION.md`, 2026-11-18)

**How it got here.** The chat began as the onboarding interviewer, typed or by voice (Gemini Live), and it wrote what you said
into the taste profile. That went wrong:
- One sentence could hide a whole genre.
- Titles you named piled up as many as 15 times.

v2 decided (PLAN.md DEC-5) that the chat is "only a feature": the For you list and the Watchlist are the product. Shahar
rebuilt it as a read-only consultant, P3-1 to P3-6 and P3-G (#251–256, #321), 8–15 November.

**What it does now** (`CHAT_MODE=consultant`):
- **Way in:** "Ask WTW" (the bubble top left on the tabs), once the onboarding is done. Typed only; the voice routes answer 404
  outside the old `legacy` mode. It opens empty on every visit and has no memory of earlier visits.
- **What it's given:** a summary of your taste, your top 20 For you picks (not rated yet), and your newest 20 Watchlist saves
  (not rated yet) (`src/app/api/conversation/message/context.ts`).
- **Answers are checked before they're shown** (`grounding.ts`). Every title has to be one of ours, and every number and name
  has to be in our facts. A sentence that fails is cut after one retry, and a fixed line covers the case where nothing passes.
- **It adds to the Watchlist** only when you ask in so many words ("add Heat"). If more than one title matches, it asks which.
  At most 3 titles a turn, adding only (`watchlist.ts`).
- **It never changes your taste, your rules or your feed.** `tests/unit/chat-read-only.test.ts` fails on any write besides
  that one Watchlist save. "Never show me horror" gets a refusal and where to change it.
- **Limits:**
  - 4,000 characters a message.
  - 10 turns a day per person.
  - **20 turns a day for everyone together.** That's the free Groq budget (about 200k tokens a day on `gpt-oss-120b`, shared
    with other features); a turn costs about 2,300 tokens, or twice that when the first draft fails its check.
- **P3-G passed on 2026-11-15:** 10 scripted questions, all titles real, the DNA byte for byte unchanged.
- Whether production runs `CHAT_MODE=consultant` yet: check INTEGRATION.md or Vercel before v4. This session didn't check.

## What v3 decided that touches the chat

- **Search finds a title; the chat helps you decide what to watch** (`SEARCH.md` DEC-1, Eran). That's the chat's job from now
  on.
- **Finding a title from a description** ("the one where the guy relives the same day") belongs to Search, not the chat, and is
  parked there (`SEARCH.md` §P).
- **Back from the chat returns to the screen it was opened from** (`YOU.md` DEC-1).

## P · Parked, for v4

- **The chat's role.** It's a side feature (v2's DEC-5), the backlog has "the whole app's main experience", and on 5 November
  Eran considered removing it altogether. Not decided; it's v4's first question.
- **The budget comes first.** 20 turns a day for everyone is enough for a demo, not for a main experience. A bigger role means a
  paid model or much harder rationing, and that has to be settled before any design.
- **Ideas already on the table:**
  - "Watching with the kids tonight": a mood for tonight's picks that doesn't teach your taste (BACKLOG 2026-11-06).
  - "Ask about this" from a card: Eran said no to it for now on 2026-11-14 (PLAN Q5).
  - Remembering earlier visits.
  - Voice: off since v2.
