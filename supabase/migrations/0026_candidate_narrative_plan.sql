-- 0026 — plan the narrative candidate query per call, so it uses the vector index.
--
-- get_candidate_titles_by_narrative (0021) is plpgsql with `limit pool_limit`
-- and the arrays as parameters. After a few executions plpgsql switches to a
-- cached GENERIC plan, which cannot see the LIMIT or the array sizes, and that
-- plan scans the whole catalog (34,973 titles) computing every distance
-- instead of walking idx_titles_narrative_embedding. Measured live
-- 2026-11-05: 1.3–2.2 s per call inside the function, 45 ms for the identical
-- SQL run directly; pg_stat_statements has the function at a mean of 2.0–2.7 s
-- over ~1,150 calls (max 7.9 s). It is step 1 of every recommendation batch
-- ("Find more"): step 1 was 5.6 s of an 8.4 s batch in the 11:21 production run.
--
-- `return query execute` plans the statement on every call with the real
-- LIMIT inlined and the real arrays bound, so the planner picks the index
-- scan. Same body, same arguments, same results (checked: identical first 50
-- for the same inputs); 45–116 ms per call across type/limit variants.
--
-- One deliberate difference: pool_limit null used to mean `limit null` (every
-- row); it is now 150, and 0 or less becomes 1. No caller passes either
-- (step1-candidate-gen.ts always passes a positive number).
--
-- The index is ivfflat (lists = 100), so `ivfflat.probes` is the right knob;
-- it is kept at 10 as in 0021.
--
-- Cold start: the index is 103 MB and the instance has 280 MB of shared
-- buffers, so after a restart or eviction the first few calls read it from
-- disk (0.3–1.6 s measured), then ~50 ms. Keeping it warm is in
-- docs/speed-plan.md.
--
-- Rollback: re-run the 0021 body (0021_titles_language_keywords.sql:122-160).
--
-- Run it with pg from here (SUPABASE_DB_URL), like 0025. Applied live
-- 2026-11-05.

create or replace function public.get_candidate_titles_by_narrative(
  query_embedding   vector(1024),
  exclude_keys      text[],
  title_type        text    default null,
  max_runtime       integer default null,
  pool_limit        integer default 150,
  min_votes         integer default 100,
  exclude_genres    text[]  default '{}',
  exclude_keywords  text[]  default '{}',
  exclude_languages text[]  default '{}'
)
returns setof public.titles_candidate
language plpgsql
stable
security definer
as $$
begin
  begin
    perform set_config('ivfflat.probes', '10', true);
  exception when others then
    null;
  end;
  -- pool_limit is inlined as a literal (it is an integer, not user text); the
  -- rest are bound with USING. Planned per call: see the header.
  return query execute format($q$
    select c.*
    from public.titles t
    join public.titles_candidate c on c.id = t.id
    where
      t.enriched_at is not null
      and t.narrative_embedding is not null
      and coalesce(t.tmdb_vote_count, 0) >= $3
      and (t.type || ':' || t.tmdb_id) != all(coalesce($2, '{}'::text[]))
      and ($4 is null or t.type = $4)
      and ($5 is null or t.runtime_minutes is null or t.runtime_minutes <= $5)
      and not public.title_is_excluded(c.genres, c.keywords, c.original_language, $6, $7, $8)
    order by t.narrative_embedding <=> $1::halfvec(1024)
    limit %s
  $q$, greatest(coalesce(pool_limit, 150), 1))
  using query_embedding, exclude_keys, min_votes, title_type, max_runtime,
        exclude_genres, exclude_keywords, exclude_languages;
end;
$$;
