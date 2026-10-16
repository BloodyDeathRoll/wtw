-- ============================================================
-- WTW — Server-side watchlist
--
-- One row per saved card, so the watchlist follows the login across
-- devices. Until now it lived only in localStorage (src/lib/watchlist.ts);
-- that copy is now a cache, and the first load after this ships uploads
-- whatever each device already holds.
--
-- `rec` and `explain` are the client's own snapshots (the full card and its
-- "Why this pick?" breakdown), stored as-is so the view renders without a
-- refetch. They are only ever read back by the same user.
--
-- Separate from the fingerprint's "saved" marker in recommendation_history,
-- which still rides on /api/session/end (watchlist-intent.ts).
-- Safe to re-run — all statements are idempotent.
-- ============================================================

create table if not exists public.watchlist_entries (
  user_id     uuid references public.users(id) on delete cascade not null,
  -- Recommendation id: "type:tmdb_id" for engine recs (never a bare tmdb_id —
  -- movie and TV ids collide, see 0014), a bare slug for pre-session mocks.
  rec_id      text not null,
  rec         jsonb not null,
  explain     jsonb,
  rating      text check (rating in ('loved', 'liked', 'disliked', 'removed')),
  added_at    timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, rec_id)
);

alter table public.watchlist_entries enable row level security;

drop policy if exists "watchlist_entries_select_own" on public.watchlist_entries;
create policy "watchlist_entries_select_own"
  on public.watchlist_entries
  for select using (auth.uid() = user_id);

drop policy if exists "watchlist_entries_insert_own" on public.watchlist_entries;
create policy "watchlist_entries_insert_own"
  on public.watchlist_entries
  for insert with check (auth.uid() = user_id);

-- Re-saving a card and tagging its rating both upsert the row.
drop policy if exists "watchlist_entries_update_own" on public.watchlist_entries;
create policy "watchlist_entries_update_own"
  on public.watchlist_entries
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "watchlist_entries_delete_own" on public.watchlist_entries;
create policy "watchlist_entries_delete_own"
  on public.watchlist_entries
  for delete using (auth.uid() = user_id);

create index if not exists watchlist_entries_user_time_idx
  on public.watchlist_entries (user_id, added_at desc);

-- Keep updated_at honest for writes that don't go through /api/watchlist.
create or replace function public.watchlist_entries_touch()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists watchlist_entries_touch on public.watchlist_entries;
create trigger watchlist_entries_touch
  before update on public.watchlist_entries
  for each row execute function public.watchlist_entries_touch();
