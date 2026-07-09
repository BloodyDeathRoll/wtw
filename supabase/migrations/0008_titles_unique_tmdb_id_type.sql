-- ============================================================
-- WTW — Migration 0008: titles unique on (tmdb_id, type)
-- Run after 0002_rec_engine.sql. Safe to re-run.
-- ============================================================
--
-- TMDB movie ids and TV ids are SEPARATE namespaces — a movie and a TV show
-- can legitimately share the same numeric id (e.g. id 1396 is the TV show
-- Breaking Bad and also an unrelated movie). The original single-column
-- `unique (tmdb_id)` meant seeding one type would silently OVERWRITE a row of
-- the other type via `on conflict (tmdb_id) do update` — catalog corruption,
-- not just a missed duplicate. This risk grows as the nightly grow job mixes
-- movie/tv discovery across a rotating sweep.
--
-- Fix: widen the uniqueness to the composite (tmdb_id, type) so both coexist
-- as distinct rows. The plain lookup index idx_titles_tmdb_id is kept.

do $$
begin
  -- Drop the old single-column unique (Postgres auto-named it titles_tmdb_id_key
  -- for the column-level `tmdb_id text not null unique` in 0002_rec_engine.sql).
  if exists (
    select 1 from pg_constraint where conname = 'titles_tmdb_id_key'
  ) then
    alter table public.titles drop constraint titles_tmdb_id_key;
  end if;

  -- Add the composite unique (idempotent).
  if not exists (
    select 1 from pg_constraint where conname = 'titles_tmdb_id_type_key'
  ) then
    alter table public.titles
      add constraint titles_tmdb_id_type_key unique (tmdb_id, type);
  end if;
end
$$;
