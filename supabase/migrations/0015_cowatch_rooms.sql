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
-- Because membership is the authorisation, the two things that keep it honest are
-- (1) no client-writable path to a row — see the policy block below — and (2) a
-- short life for an unclaimed room, so the 10,000-code space can't be swept.
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
  -- Two-stage expiry. An UNCLAIMED room lives 5 minutes, because 4 digits is
  -- only ~10,000 codes and anyone can dial them: a joiner becomes a member, and
  -- members get co-watch explanations that describe the other person's taste in
  -- prose. A 2-hour window to sweep the whole code space is far too generous, so
  -- the room is only joinable for about as long as it takes to read the digits
  -- out loud. POST /api/cowatch/room/join extends this to the full session
  -- length once the guest slot is actually claimed.
  expires_at  timestamptz default (now() + interval '5 minutes') not null,
  -- A room is between two DIFFERENT people.
  constraint cowatch_rooms_distinct_members check (guest_id is null or guest_id <> host_id)
);

-- Explicit, so re-running this migration over a table created by an earlier
-- version of it still shortens the window (`create table if not exists` above
-- would silently keep the old default).
alter table public.cowatch_rooms
  alter column expires_at set default (now() + interval '5 minutes');

alter table public.cowatch_rooms enable row level security;

-- ⚠️ THIS TABLE HAS NO INSERT OR UPDATE POLICY, DELIBERATELY. DO NOT ADD ONE.
--
-- Membership in this table IS the authorisation for reading another user's taste
-- (POST /api/recommendations/cowatch derives the partner from it). This schema is
-- in `public`, so it is reachable over PostgREST with the anon key — which ships
-- to the browser — plus any user's JWT. A client-writable row therefore means a
-- client-forgeable pairing, which is the IDOR this migration exists to close:
--
--   • An INSERT policy checking only `auth.uid() = host_id` lets an attacker
--     insert { host_id: self, guest_id: victim } and then call the endpoint —
--     no code-guessing needed, full read of the victim's taste.
--   • An UPDATE policy cannot express "and don't touch host_id": RLS sees NEW in
--     WITH CHECK and OLD in USING, never both, so a single statement can claim
--     the guest slot AND rewrite host_id to a victim (and extend expires_at).
--
-- Both write paths belong to the routes, which use the service-role client and do
-- the membership checks themselves. With RLS enabled and no permissive policy,
-- every client write is denied by default. That is the intended state.
drop policy if exists "cowatch_rooms_insert_host" on public.cowatch_rooms;
drop policy if exists "cowatch_rooms_join_as_guest" on public.cowatch_rooms;

-- Reading your own room is safe and useful (a client can poll for the guest to
-- arrive). Scoped to members, and it exposes nothing a member doesn't know.
drop policy if exists "cowatch_rooms_select_member" on public.cowatch_rooms;
create policy "cowatch_rooms_select_member"
  on public.cowatch_rooms
  for select using (auth.uid() = host_id or auth.uid() = guest_id);

-- The host can close their own room early. Safe to keep: the worst a caller can
-- do is delete a room they host, and they can't insert a replacement.
drop policy if exists "cowatch_rooms_delete_host" on public.cowatch_rooms;
create policy "cowatch_rooms_delete_host"
  on public.cowatch_rooms
  for delete using (auth.uid() = host_id);

-- Supports the expired-row purge on create.
create index if not exists cowatch_rooms_expires_idx
  on public.cowatch_rooms (expires_at);
