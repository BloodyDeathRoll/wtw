-- 0016 — poster re-check rotation cursor
--
-- Same shape and same reason as 0012 (last_trailer_check), for the poster
-- backfill in scripts/grow-catalog.mts §3. That step selected
-- `poster_path IS NULL` rows in unspecified order and only wrote back when TMDB
-- actually had a poster — so a title with genuinely no poster was never
-- recorded as checked, stayed in the NULL set, and was re-fetched every night
-- forever, while the rows behind it in the limit window were never reached.
-- Measured: `posters_backfilled` was 0 on 19 of 19 committed nightly summaries.
--
-- NULL means never checked → picked first. Safe to re-run.

alter table titles
  add column if not exists last_poster_check timestamptz;

comment on column titles.last_poster_check is
  'When poster_path was last looked up on TMDB (null = never). Drives the '
  'least-recently-checked rotation of the poster backfill.';

-- The sweep scans `WHERE poster_path IS NULL ORDER BY last_poster_check ASC
-- NULLS FIRST`; this partial index keeps that ordered scan cheap and small
-- (only rows still missing a poster).
create index if not exists titles_poster_recheck_idx
  on titles (last_poster_check asc nulls first)
  where poster_path is null;
