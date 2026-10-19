-- ============================================================
-- WTW — Migration 0024: taste-games progress (/play, Slice 1).
-- See docs/taste-games-handoff.md. Safe to re-run.
-- ============================================================
--
-- Additive only: two new tables, nothing existing is touched. users.dna is
-- deliberately NOT written by the games in Slice 1 — the event log below is
-- what Slice 2 replays into the DNA through A3's writer.
--
-- 1. play_state  — one row per player: where they are (genre choices, the
--    in-game taste estimate, chapter, levels, game scores). Overwritten as
--    they play; it is a save slot, not history.
-- 2. play_events — append-only log of every answer (a duel pick, a hunch
--    confirmed, a bet, a "never" genre...). Two jobs: "no repeats" (every
--    item served is recorded under `item_key`, and an item is never served
--    twice), and the input Slice 2 feeds into the fingerprint.
--
-- Both are readable and writable only by their own user (RLS). Events can be
-- inserted but never updated or deleted by a user — the log stays honest.

-- ── 1. play_state ───────────────────────────────────────────────

create table if not exists public.play_state (
  user_id     uuid primary key references public.users(id) on delete cascade,
  state       jsonb not null default '{}'::jsonb,
  -- Bumped by the client on every save; a save carrying an older version is
  -- refused, so two open tabs can't silently overwrite each other.
  version     integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.play_state enable row level security;

drop policy if exists "play_state_select_own" on public.play_state;
create policy "play_state_select_own" on public.play_state
  for select using (auth.uid() = user_id);

drop policy if exists "play_state_insert_own" on public.play_state;
create policy "play_state_insert_own" on public.play_state
  for insert with check (auth.uid() = user_id);

drop policy if exists "play_state_update_own" on public.play_state;
create policy "play_state_update_own" on public.play_state
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── 2. play_events ──────────────────────────────────────────────

create table if not exists public.play_events (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  -- What happened: 'genres', 'duel', 'hunch', 'plot_twist', 'bet',
  -- 'mind_reader', 'bonus', 'slider', 'chapter' … Free text so a new game
  -- needs no migration.
  kind        text not null,
  -- The thing that was served, for "no repeats": a title ('movie:603'), a
  -- duel pair ('movie:603|movie:155'), later a story id. Null for events
  -- that serve nothing (a slider edit).
  item_key    text,
  payload     jsonb not null default '{}'::jsonb
);

alter table public.play_events enable row level security;

drop policy if exists "play_events_select_own" on public.play_events;
create policy "play_events_select_own" on public.play_events
  for select using (auth.uid() = user_id);

drop policy if exists "play_events_insert_own" on public.play_events;
create policy "play_events_insert_own" on public.play_events
  for insert with check (auth.uid() = user_id);
-- No update/delete policy: append-only for users.

create index if not exists play_events_user_time_idx
  on public.play_events (user_id, created_at desc);

create index if not exists play_events_user_item_idx
  on public.play_events (user_id, item_key)
  where item_key is not null;

-- updated_at on play_state, reusing the trigger function from 0001.
drop trigger if exists play_state_updated_at on public.play_state;
create trigger play_state_updated_at
  before update on public.play_state
  for each row execute procedure public.handle_updated_at();
