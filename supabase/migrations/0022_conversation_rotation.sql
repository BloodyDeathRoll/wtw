-- Conversation rotation (2026-09-20).
--
-- getOrCreateActiveConversation returned the user's most recent conversation
-- and nothing ever closed one, so every user had exactly ONE conversation for
-- their whole life with the app. Two consequences, both measured on a live
-- account: `session_number` sat at 1 forever, and `/api/session/end` re-read
-- and re-analysed the entire message history every single time — 105 messages
-- going back to June, on every session end, through the extraction LLM.
--
-- `ended_at` is the missing state. A conversation with it set is finished and
-- is never handed back; the next visit starts a fresh one, numbered.

alter table public.conversations
  add column if not exists ended_at timestamptz;

-- The lookup is "this user's open conversation, most recent first".
create index if not exists conversations_user_open_idx
  on public.conversations (user_id, last_active_at desc)
  where ended_at is null;

-- Existing rows stay open, so nobody loses the conversation they are in; they
-- rotate the first time a session ends after this ships.
