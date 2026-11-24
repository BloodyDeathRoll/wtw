-- 0037 — "Send us feedback" (v3 Y2, docs/plan/v3/YOU.md DEC-5, issue #370).
--
-- Every note is saved here first, then emailed to the team's inbox (Resend);
-- a failed email never loses a note: emailed_at stays empty and the nightly
-- retry (/api/cron/feedback) tries again, up to 5 attempts.
--
-- Only the server reads and writes it (service role): row security on, no
-- policies, and nothing granted to anon or authenticated, so nobody can read
-- anyone else's notes. A note goes with its user (Delete my account, Y3):
-- users.id references auth.users on delete cascade, and this references users.
--
-- Rollback: drop table if exists public.feedback;

create table if not exists public.feedback (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.users(id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 2000),
  created_at  timestamptz not null default now(),
  user_agent  text,
  emailed_at  timestamptz,
  attempts    integer not null default 0
);

-- The nightly retry reads only the unsent ones.
create index if not exists feedback_unsent_idx on public.feedback (created_at) where emailed_at is null;
create index if not exists feedback_user_idx on public.feedback (user_id);

alter table public.feedback enable row level security;
revoke all on public.feedback from anon, authenticated;
