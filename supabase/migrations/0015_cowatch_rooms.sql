-- ============================================================
-- WTW — Co-watch rooms
--
-- Membership state for the 4-digit co-watch room. Before this table,
-- POST /api/recommendations/cowatch took `user_id_b` straight from the
-- request body and loaded that user's DNA with the service-role client —
-- so ANY authenticated user could read ANY other user's taste profile by
-- guessing a user id (the room_code was only ever a Redis cache key, never
-- checked against anything). That is the IDOR this table closes: the route
-- now derives the partner from room membership and ignores client-supplied
-- user ids entirely.
--
-- Safe to re-run — all statements are idempotent.
-- ============================================================

create table if not exists public.cowatch_rooms (
  -- The 4-digit code the two viewers share out loud. Primary key, so only one
  -- LIVE room can hold a given code; expired rows are purged on create.
  code        text primary key check (code ~ '^[0-9]{4}$'),
  host_id     uuid references public.users(id) on delete cascade not null,
  -- Claimed when the second viewer joins. Null = room is waiting.
  guest_id    uuid references public.users(id) on delete cascade,
  created_at  timestamptz default now() not null,
  expires_at  timestamptz default (now() + interval '2 hours') not null,
  -- A room is between two DIFFERENT people.
  constraint cowatch_rooms_distinct_members check (guest_id is null or guest_id <> host_id)
);

alter table public.cowatch_rooms enable row level security;

-- Members can read their own room. Note the API routes use the service-role
-- client (they must look a room up by code BEFORE the caller is known to be a
-- member), so these policies are defence-in-depth for direct client access —
-- the authorisation that actually gates co-watch lives in the route.
drop policy if exists "cowatch_rooms_select_member" on public.cowatch_rooms;
create policy "cowatch_rooms_select_member"
  on public.cowatch_rooms
  for select using (auth.uid() = host_id or auth.uid() = guest_id);

-- You may only open a room as yourself.
drop policy if exists "cowatch_rooms_insert_host" on public.cowatch_rooms;
create policy "cowatch_rooms_insert_host"
  on public.cowatch_rooms
  for insert with check (auth.uid() = host_id);

-- Joining claims the empty guest slot, and only for yourself. The `using`
-- clause is what stops a third party from evicting an existing guest.
drop policy if exists "cowatch_rooms_join_as_guest" on public.cowatch_rooms;
create policy "cowatch_rooms_join_as_guest"
  on public.cowatch_rooms
  for update using (guest_id is null and auth.uid() <> host_id)
  with check (guest_id = auth.uid());

-- The host can close their room early.
drop policy if exists "cowatch_rooms_delete_host" on public.cowatch_rooms;
create policy "cowatch_rooms_delete_host"
  on public.cowatch_rooms
  for delete using (auth.uid() = host_id);

-- Supports the expired-row purge on create.
create index if not exists cowatch_rooms_expires_idx
  on public.cowatch_rooms (expires_at);
