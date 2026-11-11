-- 0030 — the taste candidate pool (docs/plan/PLAN.md, P1-E6).
--
-- Under FORMULA_V2, step 1's second FRESH pool is "the titles the user's
-- taste model scores highest", replacing the narrative pool. The model is
-- trained per call in TypeScript (src/modules/dna/taste-model.ts) and its 25
-- weights are passed in as user_w; a title's model score is user_w · taste_vec,
-- so the best fits come first in ascending `taste_vec <#> user_w` (pgvector's
-- negative inner product).
--
-- Same shape as get_candidate_titles_by_narrative (0026): the rule and
-- content-type parameters, the titles_candidate row, and `return query
-- execute` so the statement is planned per call with the real LIMIT. Plus:
--   min_votes_movie / min_votes_tv  separate floors (1,000 / 300 to start:
--                                   only 545 series clear 1,000, against
--                                   4,613 movies; tuned in R3)
--   feature_version                 only vectors built at this
--                                   TASTE_FEATURE_VERSION (features.ts)
--
-- No index: an exact scan of ~35k × 25 floats (P1-D1). Add HNSW
-- (vector_ip_ops) only if EXPLAIN ANALYZE says it's needed.
--
-- Rollback: drop function public.get_candidate_titles_by_taste(vector, text[], text, integer, integer, integer, integer, smallint, text[], text[], text[]);
--
-- Run it with pg from here (SUPABASE_DB_URL), like 0025/0026.

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
begin
  -- pool_limit is inlined as a literal (it is an integer, not user text); the
  -- rest are bound with USING. Planned per call: see 0026.
  return query execute format($q$
    select c.*
    from public.titles t
    join public.titles_candidate c on c.id = t.id
    where
      t.enriched_at is not null
      and t.taste_vec is not null
      and t.taste_version = $9
      and coalesce(t.tmdb_vote_count, 0) >= (case when t.type = 'tv' then $4 else $3 end)
      and (t.type || ':' || t.tmdb_id) != all(coalesce($2, '{}'::text[]))
      and ($5 is null or t.type = $5)
      and ($6 is null or t.runtime_minutes is null or t.runtime_minutes <= $6)
      and not public.title_is_excluded(c.genres, c.keywords, c.original_language, $7, $8, $10)
    order by t.taste_vec <#> $1
    limit %s
  $q$, greatest(coalesce(pool_limit, 150), 1))
  using user_w, exclude_keys, min_votes_movie, min_votes_tv, title_type, max_runtime,
        exclude_genres, exclude_keywords, feature_version, exclude_languages;
end;
$$;
