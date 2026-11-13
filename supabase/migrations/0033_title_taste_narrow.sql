-- 0033 — the taste pool reads a narrow table, so it is fast cold (P1-G, #240).
--
-- FORMULA_V2 went live on 2026-11-13 and was rolled back within minutes: step
-- 1 took 5–10 s in production and one call hit the statement timeout, because
-- get_candidate_titles_by_taste (0030, 0031) scanned the whole `titles` heap
-- on every call: 12,708 pages ≈ 99 MB even warm (the 6,295 eligible rows sit
-- among 83 MB of wide rows; shared_buffers is 224 MB for a 308 MB `titles`).
-- Warm that was ~350 ms; cold it came off disk.
--
-- Now the pool ranks on `title_taste`: one row per title with a taste vector,
-- holding only what the pool filters and ranks on (14 MB for 34,973 rows), then
-- joins the full titles_candidate rows for the pool_limit it keeps. Checked
-- live in a rolled-back transaction on 2026-11-13: the identical rows in the
-- identical order as 0031 for no rules, Alon's rules (horror, anime) and a
-- broad rule (drama + comedy); 2,870 pages read instead of 12,708; 26–74 ms
-- execution instead of ~350 ms warm.
--
-- A trigger keeps it in sync with `titles` (any insert, and any update of a
-- column it holds), so the finalise script and the nightly job (P1-D3) need no
-- extra step. A deleted title goes with it (on delete cascade). The rules
-- check reads lowercased arrays and is the same test as title_is_excluded
-- (0021): a genre name, a keyword or the language in the user's lists.
--
-- Rollback: re-run the 0031 body, then
--   drop trigger titles_sync_taste on public.titles;
--   drop function public.sync_title_taste();
--   drop table public.title_taste;

create table if not exists public.title_taste (
  id               integer primary key references public.titles(id) on delete cascade,
  type             text     not null,
  tmdb_id          text     not null,
  tmdb_vote_count  integer,
  runtime_minutes  integer,
  enriched         boolean  not null,
  taste_version    smallint,
  taste_vec        vector(25) not null,
  genres_lc        text[]   not null,
  keywords_lc      text[]   not null,
  lang             text     not null
);

-- Only the security-definer functions below read or write it.
alter table public.title_taste enable row level security;
revoke all on public.title_taste from anon, authenticated;

create or replace function public.sync_title_taste()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.taste_vec is null then
    delete from public.title_taste where id = new.id;
    return new;
  end if;
  insert into public.title_taste as tt (id, type, tmdb_id, tmdb_vote_count, runtime_minutes, enriched,
                                        taste_version, taste_vec, genres_lc, keywords_lc, lang)
  values (
    new.id, new.type, new.tmdb_id, new.tmdb_vote_count, new.runtime_minutes, new.enriched_at is not null,
    new.taste_version, new.taste_vec,
    array(select lower(g->>'name') from jsonb_array_elements(coalesce(new.genres, '[]'::jsonb)) g),
    array(select lower(k) from jsonb_array_elements_text(coalesce(new.keywords, '[]'::jsonb)) k),
    lower(coalesce(new.original_language, ''))
  )
  on conflict (id) do update set
    type = excluded.type, tmdb_id = excluded.tmdb_id, tmdb_vote_count = excluded.tmdb_vote_count,
    runtime_minutes = excluded.runtime_minutes, enriched = excluded.enriched,
    taste_version = excluded.taste_version, taste_vec = excluded.taste_vec,
    genres_lc = excluded.genres_lc, keywords_lc = excluded.keywords_lc, lang = excluded.lang;
  return new;
end;
$$;

drop trigger if exists titles_sync_taste on public.titles;
create trigger titles_sync_taste
  after insert or update of type, tmdb_id, tmdb_vote_count, runtime_minutes, enriched_at,
                            taste_version, taste_vec, genres, keywords, original_language
  on public.titles
  for each row execute function public.sync_title_taste();

-- Backfill.
insert into public.title_taste (id, type, tmdb_id, tmdb_vote_count, runtime_minutes, enriched,
                                taste_version, taste_vec, genres_lc, keywords_lc, lang)
select t.id, t.type, t.tmdb_id, t.tmdb_vote_count, t.runtime_minutes, t.enriched_at is not null,
       t.taste_version, t.taste_vec,
       array(select lower(g->>'name') from jsonb_array_elements(coalesce(t.genres, '[]'::jsonb)) g),
       array(select lower(k) from jsonb_array_elements_text(coalesce(t.keywords, '[]'::jsonb)) k),
       lower(coalesce(t.original_language, ''))
from public.titles t
where t.taste_vec is not null
on conflict (id) do nothing;

analyze public.title_taste;

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
        select tt.id, tt.genres_lc, tt.keywords_lc, tt.lang, tt.taste_vec <#> $1 as d
        from public.title_taste tt
        where
          tt.enriched
          and tt.taste_version = $9
          and coalesce(tt.tmdb_vote_count, 0) >= (case when tt.type = 'tv' then $4 else $3 end)
          and (tt.type || ':' || tt.tmdb_id) != all(coalesce($2, '{}'::text[]))
          and ($5 is null or tt.type = $5)
          and ($6 is null or tt.runtime_minutes is null or tt.runtime_minutes <= $6)
        order by d, tt.id
        limit %s
      ) r
      where not (
        r.genres_lc   && coalesce($7,  '{}'::text[])
        or r.keywords_lc && coalesce($8,  '{}'::text[])
        or r.lang = any(coalesce($10, '{}'::text[]))
      )
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
