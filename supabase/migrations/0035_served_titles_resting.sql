-- 0035 — v3 F4 (docs/plan/v3/FOR-YOU.md DEC-6, issue #351): cards you stopped on rest, then retire.
--
-- A For you card you stopped on (at least half on screen for at least a second) and then left alone rests when you tap
-- Refresh: about a week the first time, about a month the second, and after the third time it retires from For you.
-- Cards you flicked past count for nothing. The rules and the rest times are in src/lib/resting.ts (the times are
-- passed in, so changing them needs no migration: FOR-YOU.md Q-1).
--
-- 1. served_titles gains:
--      last_stopped_at  when the phone last reported this card stopped on; cleared when a Refresh counts it
--      skips            times stopped on and skipped (3 = retired)
--      rest_until       resting until then; null = not resting
-- 2. mark_stopped_on      — the phone's report (POST /api/recommendations/stopped).
-- 3. rest_skipped_titles  — at Refresh: each outgoing card stopped on since its 20 was made gets one more skip and its
--                           rest. Clearing last_stopped_at in the same statement means two Refreshes racing count it once.
--
-- Additive and idempotent: safe to re-run. Nothing writes or reads these while FOR_YOU_V3 is off. Rollback:
--   drop function if exists public.rest_skipped_titles(uuid, text[], timestamptz, integer[]);
--   drop function if exists public.mark_stopped_on(uuid, text[]);
--   alter table public.served_titles drop column last_stopped_at, drop column skips, drop column rest_until;

-- ── 1. Columns ─────────────────────────────────────────────────

alter table public.served_titles
  add column if not exists last_stopped_at timestamptz,
  add column if not exists skips           integer not null default 0,
  add column if not exists rest_until      timestamptz;

-- ── 2. The phone's report ──────────────────────────────────────
-- An upsert, not an update: the 20's own served row is written just after the 20 is sent, so in principle a report
-- could arrive first. The route only passes keys that are in this person's 20s.

create or replace function public.mark_stopped_on(
  p_user_id uuid,
  p_keys    text[]                       -- '${type}:${tmdb_id}'
)
returns void
language sql
security definer
as $$
  insert into public.served_titles (user_id, tmdb_id, media_type, last_stopped_at)
  select distinct p_user_id, split_part(k, ':', 2), split_part(k, ':', 1), now()
  from unnest(coalesce(p_keys, '{}'::text[])) as k
  where split_part(k, ':', 1) in ('movie', 'tv') and split_part(k, ':', 2) <> ''
  on conflict (user_id, tmdb_id, media_type) do update
    set last_stopped_at = now();
$$;

revoke all on function public.mark_stopped_on(uuid, text[]) from public, anon, authenticated;
grant execute on function public.mark_stopped_on(uuid, text[]) to service_role;

-- ── 3. Refresh counts the skips ────────────────────────────────
-- p_keys: the outgoing 20 minus what was added, rated or hidden (the server knows). p_since: when that 20 was made.
-- p_rest_secs: the rest after the 1st skip, the 2nd, …; a skip past the end of it retires (rest_until null, skips
-- at its limit — src/lib/resting.ts reads that as retired). Returns how many were counted.

create or replace function public.rest_skipped_titles(
  p_user_id   uuid,
  p_keys      text[],
  p_since     timestamptz,
  p_rest_secs integer[]
)
returns integer
language sql
security definer
as $$
  with counted as (
    update public.served_titles s
       set skips           = s.skips + 1,
           rest_until      = case
                               when s.skips + 1 <= coalesce(array_length(p_rest_secs, 1), 0)
                               then now() + make_interval(secs => p_rest_secs[s.skips + 1])
                               else null
                             end,
           last_stopped_at = null
      from (select distinct k from unnest(coalesce(p_keys, '{}'::text[])) as k) as u
     where s.user_id = p_user_id
       and s.media_type = split_part(u.k, ':', 1)
       and s.tmdb_id = split_part(u.k, ':', 2)
       and s.last_stopped_at is not null
       and s.last_stopped_at >= p_since
    returning 1
  )
  select count(*)::integer from counted;
$$;

revoke all on function public.rest_skipped_titles(uuid, text[], timestamptz, integer[]) from public, anon, authenticated;
grant execute on function public.rest_skipped_titles(uuid, text[], timestamptz, integer[]) to service_role;
