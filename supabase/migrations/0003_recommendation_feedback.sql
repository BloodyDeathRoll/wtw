-- ============================================================
-- WTW — Recommendation feedback log
-- Run this in the Supabase SQL Editor (or via supabase db push)
-- ============================================================
--
-- Every "Seen & liked" / "Don't like" tap from the user lands here as
-- its own row, time-stamped. The DNA Writer (Assignment 3, Eran) reads
-- this table alongside `messages` to derive fingerprint signals.
--
-- Intentionally NOT unique on (user_id, recommendation_id) — a user
-- changing their mind is itself a signal, and the DNA Writer wants the
-- ordered history, not just the latest verdict.

create table if not exists public.recommendation_feedback (
  id                uuid default gen_random_uuid() primary key,
  user_id           uuid references public.users(id) on delete cascade not null,
  recommendation_id text not null,
  title             text,
  rating            text not null check (rating in ('liked', 'disliked')),
  created_at        timestamptz default now() not null
);

alter table public.recommendation_feedback enable row level security;

create policy "recommendation_feedback_select_own"
  on public.recommendation_feedback
  for select using (auth.uid() = user_id);

create policy "recommendation_feedback_insert_own"
  on public.recommendation_feedback
  for insert with check (auth.uid() = user_id);

create index if not exists recommendation_feedback_user_time_idx
  on public.recommendation_feedback (user_id, created_at desc);

create index if not exists recommendation_feedback_user_rec_idx
  on public.recommendation_feedback (user_id, recommendation_id);
