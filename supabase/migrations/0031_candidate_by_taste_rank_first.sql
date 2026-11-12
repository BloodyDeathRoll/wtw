-- 0031 — get_candidate_titles_by_taste (0030): rank first, then fetch.
--
-- Measured live 2026-11-12, after P1-D2 finalised 20,336 taste vectors (0030
-- was timed on the 980 game titles): the function cost 250–410 ms warm and
-- 6.6 s cold, and made formula v2's step 1 35% slower than v1's (P1-G gate,
-- #240). EXPLAIN: it joined every eligible title's full titles_candidate row
-- (~1.4 KB, crew jsonb) and ran title_is_excluded on all ~6,300 of them
-- (jsonb unnest per row) BEFORE the ORDER BY … LIMIT.
--
-- Now: (1) rank the eligible titles on the narrow columns and keep the best
-- pool_limit × 3; (2) apply the user's rules to those only; (3) keep the
-- first pool_limit; (4) join the full rows for those alone. The rules check
-- is skipped outright when there are no rules. Ties break on id, so the
-- order is deterministic.
--
-- Same name, same arguments, same results — checked live on 2026-11-12: the
-- identical 450 rows in the identical order for no rules and for Alon's rules
-- (horror, anime); 118 → 116 ms and 412 → 150 ms. The one difference: a rule
-- so broad that it removes more than two thirds of the best-ranked titles
-- returns fewer than pool_limit rows (drama + comedy: 338 of 450). Step 1 cuts
-- the pool to 150 with the genre cap anyway (FRESH_BY_TASTE_LIMIT).
--
-- Rollback: re-run the 0030 body.

create or replace function public.get_candidate_titles_by_taste(
  user_w            vector(25),
  exclude_keys      text[],
  title_type        text     default null,
  max_runtime       integer  default null,
  pool_limit        integer  default 150,
  min_votes_movie   integer  default 1000,
  min_votes_tv      integer  default 300,
  feature_version   smallint default 1,
  exclude_genres    text[]   default '{}',
  exclude_keywords  text[]   default '{}',
  exclude_languages text[]   default '{}'
)
returns setof public.titles_candidate
language plpgsql
stable
security definer
as $$
declare
  n integer := greatest(coalesce(pool_limit, 150), 1);
begin
  -- The limits are inlined as literals (integers, not user text); the rest
  -- are bound with USING. Planned per call, as in 0026.
  return query execute format($q$
    select c.*
    from (
      select r.id, r.d
      from (
        select t.id, t.genres, t.keywords, t.original_language,
               t.taste_vec <#> $1 as d
        from public.titles t
        where
          t.enriched_at is not null
          and t.taste_vec is not null
          and t.taste_version = $9
          and coalesce(t.tmdb_vote_count, 0) >= (case when t.type = 'tv' then $4 else $3 end)
          and (t.type || ':' || t.tmdb_id) != all(coalesce($2, '{}'::text[]))
          and ($5 is null or t.type = $5)
          and ($6 is null or t.runtime_minutes is null or t.runtime_minutes <= $6)
        order by d, t.id
        limit %s
      ) r
      where coalesce(cardinality($7), 0) + coalesce(cardinality($8), 0) + coalesce(cardinality($10), 0) = 0
         or not public.title_is_excluded(r.genres, r.keywords, r.original_language, $7, $8, $10)
      order by r.d, r.id
      limit %s
    ) top
    join public.titles_candidate c on c.id = top.id
    order by top.d, top.id
  $q$, n * 3, n)
  using user_w, exclude_keys, min_votes_movie, min_votes_tv, title_type, max_runtime,
        exclude_genres, exclude_keywords, feature_version, exclude_languages;
end;
$$;
