-- 0039 — #457 (Supabase egress, #438): the nightly decay reads only the DNAs that have something to decay.
--
-- Before: /api/cron/decay read every DNA whose `learning_loop.temporal_decay_applied` was false, whole
-- (0.17–0.88 MB each), every night; the flag was saved only when something decayed, so a DNA with nothing
-- to decay was re-read forever, and a DNA that decayed once was skipped forever (later ratings never decayed).
--
-- Now the cron asks this function for the users with at least one signal watched before the cutoff
-- (18 months ago, computed by the app: apply-temporal-decay.ts `decayCutoff`) that the decay hasn't
-- marked yet (`decayed_at`, set per signal), and reads only those. A night with nothing to do reads
-- a few bytes. `watched_at` values that don't start with a date are ignored (none in production, 2026-11-26).
--
-- Server only: the cron calls it with the service role; anon and signed-in users can't (it lists user ids).
-- Additive and idempotent: safe to re-run. Rollback:
--   drop function if exists public.users_due_for_decay(date);

create or replace function public.users_due_for_decay(p_cutoff date)
returns setof uuid
language sql
stable
set search_path = public
as $$
  select u.id
  from public.users u
  where u.dna is not null
    and exists (
      select 1
      from jsonb_array_elements(coalesce(u.dna->'signals', '[]'::jsonb)) s
      where s->>'watched_at' ~ '^\d{4}-\d{2}-\d{2}'
        and left(s->>'watched_at', 10)::date < p_cutoff
        and not (s ? 'decayed_at')
    );
$$;

revoke all on function public.users_due_for_decay(date) from public, anon, authenticated;
grant execute on function public.users_due_for_decay(date) to service_role;
