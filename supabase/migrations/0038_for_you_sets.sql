-- 0038 — v3 F1 (docs/plan/v3/FOR-YOU.md DEC-1–3, issue #349): the 20, kept until Refresh.
--
-- For you shows a set of about 20 picks that stays exactly as it is (same titles, same order, same match and line) until
-- the person taps Refresh. The set lives here, on the server, so leaving and coming back, a new day or another device
-- shows the same 20. One row per person per picker setting (Movies / Series / Both: a batch is built per setting).
--
-- `recs` is the engine's RecommendationResult[] for the 20, in order, as made (src/lib/for-you-set.ts): the card is
-- rebuilt from it on every read, and "Why it's a match" falls back to it once the 6-hour batch cache has moved on.
-- Read and written by the server only (service role); RLS on, a person may read their own row.
--
-- Additive and idempotent: safe to re-run. Nothing reads it while FOR_YOU_V3 is off. Rollback:
--   drop table public.for_you_sets;

create table if not exists public.for_you_sets (
  user_id       uuid references public.users(id) on delete cascade not null,
  content_type  text not null check (content_type in ('movies', 'series', 'all')),
  recs          jsonb not null,
  taste_version integer,
  made_at       timestamptz default now() not null,
  primary key (user_id, content_type)
);

alter table public.for_you_sets enable row level security;

drop policy if exists "for_you_sets_select_own" on public.for_you_sets;
create policy "for_you_sets_select_own"
  on public.for_you_sets
  for select using (auth.uid() = user_id);
-- Writes go through the service role only.
