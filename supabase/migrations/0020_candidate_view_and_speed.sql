-- ============================================================
-- WTW — Migration 0020: "Find more" speed — light candidate rows,
-- vote-count index, embedding-text hash. Run after 0019. Safe to re-run.
-- ============================================================
--
-- 1. The three candidate RPCs returned `setof public.titles` — every row
--    carried narrative_embedding (halfvec(1024), ~7.5 KB as JSON text) and
--    nothing in the pipeline reads it: scoring goes through
--    match_titles_by_narrative in SQL. 350 candidates ≈ 2.6 MB per generation
--    for nothing (get_candidate_titles measured 4.5 s live, 2026-08-28).
--    titles_candidate is the engine's TitleRow minus the embedding.
-- 2. get_candidate_titles orders by tmdb_vote_count with no index — a seq
--    scan + sort of the whole catalog each time.
-- 3. fingerprint_embeddings.text_hash lets regenerateEmbedding skip the
--    Mistral call when the strand text it would embed hasn't changed since
--    the last version (per-click merges rarely move dominant pacing/tones).

-- ── 1. Light candidate view ───────────────────────────────────
-- Exactly the engine's TitleRow columns (src/modules/engine/types.ts) minus
-- narrative_embedding. Poster/trailer/provider columns are read separately by
-- the GET route from `titles` and are deliberately not here.

create or replace view public.titles_candidate as
  select
    id, tmdb_id, title, type, synopsis, genres, release_year, runtime_minutes,
    tmdb_rating, tmdb_vote_count, omdb_rating, crew, pacing_tag, tone_tags,
    narrative_metadata, enriched_at, created_at
  from public.titles;

-- Return types change → drop and recreate (create-or-replace can't).
drop function if exists public.get_candidate_titles(text[], text[], text, integer);
drop function if exists public.get_candidate_titles_by_narrative(vector, text[], text, integer, integer, integer);
drop function if exists public.get_served_candidates(text[], text[], text, integer, integer);

create function public.get_candidate_titles(
  watched_keys  text[],   -- '${type}:${tmdb_id}' composite keys to exclude
  excluded_ids  text[],   -- bare ids; inert today (callers pass []) — see 0014
  title_type    text    default null,
  max_runtime   integer default null
)
returns setof public.titles_candidate
language sql
stable
security definer
as $$
  select *
  from public.titles_candidate
  where
    enriched_at is not null
    and (type || ':' || tmdb_id) != all(coalesce(watched_keys, '{}'::text[]))
    and tmdb_id != all(coalesce(excluded_ids, '{}'::text[]))
    and (title_type is null or type = title_type)
    and (max_runtime is null or runtime_minutes is null or runtime_minutes <= max_runtime)
  order by tmdb_vote_count desc nulls last
  limit 200;
$$;

create function public.get_candidate_titles_by_narrative(
  query_embedding vector(1024),
  exclude_keys    text[],
  title_type      text    default null,
  max_runtime     integer default null,
  pool_limit      integer default 150,
  min_votes       integer default 100
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
  return query
    select c.*
    from public.titles t
    join public.titles_candidate c on c.id = t.id
    where
      t.enriched_at is not null
      and t.narrative_embedding is not null
      and coalesce(t.tmdb_vote_count, 0) >= min_votes
      and (t.type || ':' || t.tmdb_id) != all(coalesce(exclude_keys, '{}'::text[]))
      and (title_type is null or t.type = title_type)
      and (max_runtime is null or t.runtime_minutes is null or t.runtime_minutes <= max_runtime)
    order by t.narrative_embedding <=> query_embedding::halfvec(1024)
    limit pool_limit;
end;
$$;

create function public.get_served_candidates(
  served_keys   text[],
  exclude_keys  text[],
  title_type    text    default null,
  max_runtime   integer default null,
  pool_limit    integer default 150
)
returns setof public.titles_candidate
language sql
stable
security definer
as $$
  select *
  from public.titles_candidate
  where
    enriched_at is not null
    and (type || ':' || tmdb_id) = any(coalesce(served_keys, '{}'::text[]))
    and (type || ':' || tmdb_id) != all(coalesce(exclude_keys, '{}'::text[]))
    and (title_type is null or type = title_type)
    and (max_runtime is null or runtime_minutes is null or runtime_minutes <= max_runtime)
  order by tmdb_vote_count desc nulls last
  limit pool_limit;
$$;

-- ── 2. Vote-count index for the popularity pool ───────────────

create index if not exists idx_titles_vote_count_enriched
  on public.titles (tmdb_vote_count desc nulls last)
  where enriched_at is not null;

-- ── 3. Embedding-text hash ────────────────────────────────────

alter table public.fingerprint_embeddings
  add column if not exists text_hash text;
