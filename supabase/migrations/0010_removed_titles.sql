-- ============================================================
-- WTW — User-removed titles (suppression list)
--
-- A title the user explicitly "Removed" from their recommendations.
-- It must never be recommended again, and a future "Removed" screen
-- reads this table to let the user restore titles.
-- Safe to re-run — all statements are idempotent.
-- ============================================================

create table if not exists public.removed_titles (
  id          uuid default gen_random_uuid() primary key,
  user_id     uuid references public.users(id) on delete cascade not null,
  tmdb_id     text not null,
  media_type  text not null check (media_type in ('movie', 'tv')),
  title       text,
  removed_at  timestamptz default now() not null,
  -- One row per (user, title). Re-removing is a no-op upsert.
  unique (user_id, tmdb_id, media_type)
);

alter table public.removed_titles enable row level security;

drop policy if exists "removed_titles_select_own" on public.removed_titles;
create policy "removed_titles_select_own"
  on public.removed_titles
  for select using (auth.uid() = user_id);

drop policy if exists "removed_titles_insert_own" on public.removed_titles;
create policy "removed_titles_insert_own"
  on public.removed_titles
  for insert with check (auth.uid() = user_id);

-- Restore (used by the future "Removed" screen) deletes the row.
drop policy if exists "removed_titles_delete_own" on public.removed_titles;
create policy "removed_titles_delete_own"
  on public.removed_titles
  for delete using (auth.uid() = user_id);

create index if not exists removed_titles_user_time_idx
  on public.removed_titles (user_id, removed_at desc);
