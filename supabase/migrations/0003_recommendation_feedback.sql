-- ============================================================
-- WTW — Recommendation feedback log
-- Safe to re-run — all statements are idempotent.
-- ============================================================

create table if not exists public.recommendation_feedback (
  id                uuid default gen_random_uuid() primary key,
  user_id           uuid references public.users(id) on delete cascade not null,
  recommendation_id text not null,
  title             text,
  rating            text not null check (rating in ('liked', 'disliked')),
  created_at        timestamptz default now() not null
);

alter table public.recommendation_feedback enable row level security;

drop policy if exists "recommendation_feedback_select_own" on public.recommendation_feedback;
create policy "recommendation_feedback_select_own"
  on public.recommendation_feedback
  for select using (auth.uid() = user_id);

drop policy if exists "recommendation_feedback_insert_own" on public.recommendation_feedback;
create policy "recommendation_feedback_insert_own"
  on public.recommendation_feedback
  for insert with check (auth.uid() = user_id);

create index if not exists recommendation_feedback_user_time_idx
  on public.recommendation_feedback (user_id, created_at desc);

create index if not exists recommendation_feedback_user_rec_idx
  on public.recommendation_feedback (user_id, recommendation_id);
