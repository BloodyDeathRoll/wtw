-- ============================================================
-- WTW — Migration 0014: candidate exclusion on (tmdb_id, type)
-- Run after 0002_rec_engine.sql. Safe to re-run.
-- ============================================================
--
-- get_candidate_titles previously excluded the user's watched/rated titles by
-- `tmdb_id != all(watched_ids)`. But TMDB movie ids and TV ids are SEPARATE
-- namespaces — a movie and a TV show can share the same numeric id (see
-- 0008_titles_unique_tmdb_id_type.sql; e.g. id 1396 is both the TV show
-- Breaking Bad and an unrelated movie). Excluding on the bare id therefore
-- dropped EVERY title with that id, including an unrelated same-id title of the
-- other type the user has never seen — silently making it unrecommendable
-- (issue #30).
--
-- Fix: exclude on the composite key `type:tmdb_id` instead. The caller
-- (src/modules/engine/pipeline/step1-candidate-gen.ts) now passes
-- `${type}:${tmdb_id}` keys; dna.signals always carry `type`.
--
-- The first parameter is renamed watched_ids → watched_keys, so the old
-- signature is dropped first (create-or-replace cannot rename a parameter).

drop function if exists public.get_candidate_titles(text[], text[], text, integer);

create function public.get_candidate_titles(
  watched_keys  text[],   -- '${type}:${tmdb_id}' composite keys to exclude
  -- NOTE: excluded_ids compares on BARE tmdb_id, so it carries the same
  -- cross-type collision bug this migration fixes for watched_keys (a movie id
  -- would also drop the same-id TV title). Inert today — the only caller always
  -- passes [] (person/genre exclusion is a TS post-filter). If you ever populate
  -- it directly, switch it to composite 'type:tmdb_id' keys too (see #30).
  excluded_ids  text[],
  title_type    text    default null,
  max_runtime   integer default null
)
returns setof public.titles
language sql
stable
security definer
as $$
  select *
  from public.titles
  where
    enriched_at is not null
    and (type || ':' || tmdb_id) != all(coalesce(watched_keys, '{}'::text[]))
    and tmdb_id != all(coalesce(excluded_ids, '{}'::text[]))
    and (title_type is null or type = title_type)
    and (max_runtime is null or runtime_minutes is null or runtime_minutes <= max_runtime)
  order by tmdb_vote_count desc nulls last
  limit 200;
$$;
