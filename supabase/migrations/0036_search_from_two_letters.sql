-- 0036 — Search finds titles from the second letter, and through a one-word
-- typo (v3 Q4, docs/plan/v3/SEARCH.md DEC-6, issue #363).
--
-- Today /api/search asks TMDB only, which matches whole words: "sl" finds
-- "S.L. Film" but not Slow Horses, and "godfahter" finds nothing. Our own
-- catalogue can match the start of every word and close spellings, but a
-- lookup on `titles.title` without an index scanned the whole 83 MB heap
-- (7.3 s measured). A trigram index on lower(title) makes both cheap:
--   - word starts: lower(title) LIKE 'sl%' OR LIKE '% sl%' (the index serves LIKE)
--   - typos: word_similarity (the <% operator), for one word of 4+ letters
--
-- search_catalogue_titles returns candidates only; the route ranks and merges
-- them with TMDB's answers (src/lib/search-catalogue.ts). It returns the best-
-- known few per bucket — type × (first word starts with q or a later word) —
-- so a series isn't crowded out by films with ten times its votes; the route
-- ranks them within type (votes percentile) and keeps six.
--
-- Apply (statement by statement: CREATE INDEX CONCURRENTLY can't run inside a
-- transaction, and keeps `titles` writable while it builds):
--   1. create extension …   2. create index concurrently …   3–4. the two functions …   5. grants
-- Rollback:
--   drop function if exists public.search_catalogue_titles(text, int, int);
--   drop function if exists public.title_vote_quantiles();
--   drop index concurrently if exists public.titles_title_lower_trgm;
--   (leave pg_trgm installed; nothing else uses it, and dropping it is harmless too)

create extension if not exists pg_trgm with schema extensions;

create index concurrently if not exists titles_title_lower_trgm
  on public.titles using gin (lower(title) extensions.gin_trgm_ops);

create or replace function public.search_catalogue_titles(
  q          text,
  per_bucket int default 15,
  fuzzy_lim  int default 8
)
returns table (
  tmdb_id         text,
  type            text,
  title           text,
  release_year    int,
  poster_path     text,
  tmdb_vote_count int,
  first_word      boolean,
  similarity      real
)
language sql
stable
security invoker
set search_path = public, extensions
-- The <% operator's cut-off: "godfahter" ~ "The Godfather" scores 0.43.
set pg_trgm.word_similarity_threshold = 0.4
as $$
  with qq as (
    -- LIKE's own wildcards in what was typed are matched literally.
    select l, replace(replace(replace(l, '\', '\\'), '%', '\%'), '_', '\_') as e
    from (select lower(btrim(q)) as l) s
    where length(lower(btrim(q))) >= 2
  ),
  starts as (
    select t.tmdb_id, t.type, t.title, t.release_year, t.poster_path,
           coalesce(t.tmdb_vote_count, 0) as votes,
           lower(t.title) like qq.e || '%'
             or lower(t.title) like 'the ' || qq.e || '%'
             or lower(t.title) like 'a ' || qq.e || '%'
             or lower(t.title) like 'an ' || qq.e || '%' as first_word
    from public.titles t, qq
    where lower(t.title) like qq.e || '%' or lower(t.title) like '% ' || qq.e || '%'
  ),
  ranked as (
    select s.*, row_number() over (partition by s.type, s.first_word order by s.votes desc) as rn
    from starts s
  ),
  fuzzy as (
    -- One word of 4+ letters that no title starts a word with: a typo, maybe.
    select t.tmdb_id, t.type, t.title, t.release_year, t.poster_path,
           coalesce(t.tmdb_vote_count, 0) as votes,
           word_similarity(qq.l, lower(t.title)) as sim
    from public.titles t, qq
    where length(qq.l) >= 4 and qq.l !~ '\s'
      and not exists (select 1 from starts)
      and qq.l <% lower(t.title)
    order by sim desc, votes desc
    limit fuzzy_lim
  )
  select tmdb_id, type, title, release_year, poster_path, votes::int, first_word, null::real
  from ranked where rn <= per_bucket
  union all
  select tmdb_id, type, title, release_year, poster_path, votes::int, false, sim::real
  from fuzzy
$$;

-- How well known a title is, within its type: series get far fewer votes than
-- films (545 series clear 1,000 votes, against 4,613 movies), so the route
-- ranks on the vote percentile within type. 101 cut points per type from the
-- narrow title_taste table (14 MB, one row per title); the route caches them
-- for a day.
create or replace function public.title_vote_quantiles()
returns table (type text, cuts int[])
language sql
stable
security invoker
set search_path = public
as $$
  select tt.type,
         percentile_disc((select array_agg(g / 100.0) from generate_series(0, 100) g))
           within group (order by coalesce(tt.tmdb_vote_count, 0))::int[]
  from public.title_taste tt
  group by tt.type
$$;

revoke all on function public.search_catalogue_titles(text, int, int) from public, anon, authenticated;
grant execute on function public.search_catalogue_titles(text, int, int) to service_role;
revoke all on function public.title_vote_quantiles() from public, anon, authenticated;
grant execute on function public.title_vote_quantiles() to service_role;
