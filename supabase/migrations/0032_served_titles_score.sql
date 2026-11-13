-- 0032 — served_titles remembers the score a card was served with (soft-launch
-- "live score", docs/plan/PLAN.md §6).
--
-- The live score is the deck's metric on real use: per user, the concordance
-- between the score a card had when it was served and the reaction it then
-- got. Nothing stored that score: recommendation_history has the reaction, and
-- the batch with its composite_score lives only in the 6 h rec cache. So the
-- generate route now passes each page's scores, and the formula that made
-- them, to record_served_titles.
--   last_score    composite_score at the latest serve (0 = cold start, no claim)
--   last_formula  'v1' | 'v2' | 'cold' (v2 batches carry the `taste` field)
-- Both nullable: rows served before this have neither, and the old
-- two-argument call still works (the new parameters default to null and never
-- overwrite a known score with null).
--
-- Also: the function was executable by anon and authenticated (default
-- privileges) although it is security definer and takes any user id. Only the
-- server calls it (service role), so it is now service_role only.
--
-- Rollback: drop the new function, re-run the 0019 body (section 4), and
-- `alter table public.served_titles drop column last_score, drop column last_formula;`

alter table public.served_titles
  add column if not exists last_score   real,
  add column if not exists last_formula text;

-- The signature changes, and keeping the old one beside it would make a
-- two-argument call ambiguous, so drop and recreate.
drop function if exists public.record_served_titles(uuid, text[]);

create function public.record_served_titles(
  p_user_id  uuid,
  p_keys     text[],                     -- '${type}:${tmdb_id}'
  p_scores   real[] default null,        -- composite_score per key, same order
  p_formulas text[] default null         -- 'v1' | 'v2' | 'cold' per key
)
returns void
language sql
security definer
as $$
  insert into public.served_titles (user_id, tmdb_id, media_type, last_score, last_formula)
  select p_user_id, split_part(u.k, ':', 2), split_part(u.k, ':', 1), p_scores[u.i], p_formulas[u.i]
  from unnest(coalesce(p_keys, '{}'::text[])) with ordinality as u(k, i)
  where split_part(u.k, ':', 1) in ('movie', 'tv') and split_part(u.k, ':', 2) <> ''
  on conflict (user_id, tmdb_id, media_type) do update
    set last_served_at = now(),
        times_served   = public.served_titles.times_served + 1,
        last_score     = coalesce(excluded.last_score, public.served_titles.last_score),
        last_formula   = coalesce(excluded.last_formula, public.served_titles.last_formula);
$$;

revoke all on function public.record_served_titles(uuid, text[], real[], text[]) from public, anon, authenticated;
grant execute on function public.record_served_titles(uuid, text[], real[], text[]) to service_role;
