-- ============================================================
-- WTW — Migration 0021: catalog columns that make user exclusion rules
-- expressible, and SQL-side exclusion on the three candidate RPCs.
-- Run after 0020. Safe to re-run.
-- ============================================================
--
-- Why: dna.contextual_logic.exclusion_rules could only ever be matched
-- against genre names and tone_tags, so "no anime", "no Bollywood",
-- "nothing French" and every franchise/topic rule silently matched nothing.
-- Anime is not a TMDB genre — it is Animation + Japanese, and TMDB does
-- carry it as a keyword. Neither original_language nor keywords existed on
-- titles, so there was nothing to match on.
--
-- The exclusion filter also has to run in SQL, not only in TypeScript after
-- the fact: the candidate RPCs are LIMIT-ed, so post-filtering a broad rule
-- ("no anime" on an anime-heavy fingerprint) collapses the pool to a handful
-- of rows. Person and conjunction rules stay in TypeScript, where they only
-- ever drop a few rows.

-- ── 1. Columns ────────────────────────────────────────────────

alter table public.titles
  add column if not exists original_language text,
  add column if not exists keywords jsonb not null default '[]'::jsonb;

comment on column public.titles.original_language is
  'TMDB original_language, ISO 639-1 (e.g. ja, ko, hi, fr). Null until backfilled.';
comment on column public.titles.keywords is
  'TMDB keywords as a lowercased string array, e.g. ["anime","time travel"].';

-- Rows still awaiting the backfill (scripts/backfill-language-keywords.mts).
create index if not exists idx_titles_needs_language
  on public.titles (id) where original_language is null;

-- Keyword containment (`keywords ?| array[...]`) needs a GIN index to stay
-- off a seq scan of the whole catalog on every candidate query.
create index if not exists idx_titles_keywords_gin
  on public.titles using gin (keywords jsonb_path_ops);

create index if not exists idx_titles_original_language
  on public.titles (original_language);

-- ── 2. Candidate view carries the new columns ─────────────────
-- The engine's TitleRow gains original_language + keywords; the embedding
-- stays out (see 0020).

drop view if exists public.titles_candidate cascade;

create view public.titles_candidate as
  select
    id, tmdb_id, title, type, synopsis, genres, release_year, runtime_minutes,
    tmdb_rating, tmdb_vote_count, omdb_rating, crew, pacing_tag, tone_tags,
    narrative_metadata, original_language, keywords, enriched_at, created_at
  from public.titles;

-- ── 3. Shared exclusion predicate ─────────────────────────────
-- OR semantics: a title is excluded if it matches ANY listed genre name,
-- TMDB keyword, or original language. Kept as one function so all three RPCs
-- and any future caller share exactly one definition of "excluded".
-- Note: the jsonb unnest defeats idx_titles_keywords_gin, so this is a row
-- predicate, not an index lookup — measured acceptable at catalog size, and
-- it only runs at all when the user actually has rules.

create or replace function public.title_is_excluded(
  p_genres      jsonb,
  p_keywords    jsonb,
  p_language    text,
  ex_genres     text[],
  ex_keywords   text[],
  ex_languages  text[]
)
returns boolean
language sql
immutable
as $$
  select
    (coalesce(array_length(ex_genres, 1), 0) > 0 and exists (
      select 1 from jsonb_array_elements(coalesce(p_genres, '[]'::jsonb)) g
      where lower(g->>'name') = any(ex_genres)
    ))
    or (coalesce(array_length(ex_keywords, 1), 0) > 0 and exists (
      select 1 from jsonb_array_elements_text(coalesce(p_keywords, '[]'::jsonb)) k
      where lower(k) = any(ex_keywords)
    ))
    or (coalesce(array_length(ex_languages, 1), 0) > 0
        and lower(coalesce(p_language, '')) = any(ex_languages));
$$;

-- ── 4. RPCs: OR-semantics exclusion on genre / keyword / language ──
-- `cascade` above dropped the three functions with the view. Recreated here
-- with three new array params; all default to '{}' so a caller that passes
-- none behaves exactly as before.

create function public.get_candidate_titles(
  watched_keys      text[],   -- '${type}:${tmdb_id}' composite keys to exclude
  excluded_ids      text[],   -- bare ids; inert today (callers pass []) — see 0014
  title_type        text    default null,
  max_runtime       integer default null,
  exclude_genres    text[]  default '{}',   -- lowercased genre names
  exclude_keywords  text[]  default '{}',   -- lowercased TMDB keywords
  exclude_languages text[]  default '{}'    -- ISO 639-1 codes
)
returns setof public.titles_candidate
language sql
stable
security definer
as $$
  select *
  from public.titles_candidate c
  where
    enriched_at is not null
    and (type || ':' || tmdb_id) != all(coalesce(watched_keys, '{}'::text[]))
    and tmdb_id != all(coalesce(excluded_ids, '{}'::text[]))
    and (title_type is null or type = title_type)
    and (max_runtime is null or runtime_minutes is null or runtime_minutes <= max_runtime)
    and not public.title_is_excluded(c.genres, c.keywords, c.original_language,
                                     exclude_genres, exclude_keywords, exclude_languages)
  order by tmdb_vote_count desc nulls last
  limit 200;
$$;

create function public.get_candidate_titles_by_narrative(
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
      and not public.title_is_excluded(c.genres, c.keywords, c.original_language,
                                       exclude_genres, exclude_keywords, exclude_languages)
    order by t.narrative_embedding <=> query_embedding::halfvec(1024)
    limit pool_limit;
end;
$$;

create function public.get_served_candidates(
  served_keys       text[],
  exclude_keys      text[],
  title_type        text    default null,
  max_runtime       integer default null,
  pool_limit        integer default 150,
  exclude_genres    text[]  default '{}',
  exclude_keywords  text[]  default '{}',
  exclude_languages text[]  default '{}'
)
returns setof public.titles_candidate
language sql
stable
security definer
as $$
  select *
  from public.titles_candidate c
  where
    enriched_at is not null
    and (type || ':' || tmdb_id) = any(coalesce(served_keys, '{}'::text[]))
    and (type || ':' || tmdb_id) != all(coalesce(exclude_keys, '{}'::text[]))
    and (title_type is null or type = title_type)
    and (max_runtime is null or runtime_minutes is null or runtime_minutes <= max_runtime)
    and not public.title_is_excluded(c.genres, c.keywords, c.original_language,
                                     exclude_genres, exclude_keywords, exclude_languages)
  order by tmdb_vote_count desc nulls last
  limit pool_limit;
$$;
