-- 0012 — trailer re-check rotation cursor
--
-- Records when each title's trailer_key was last looked up on TMDB, so the
-- nightly trailer sweep (scripts/grow-catalog.mts §3b) can round-robin the
-- `trailer_key IS NULL` backlog by least-recently-checked instead of a window
-- keyed off catalog size (which stalls once catalog growth stops). NULL means
-- never checked → picked first. Safe to re-run.

alter table titles
  add column if not exists last_trailer_check timestamptz;

comment on column titles.last_trailer_check is
  'When trailer_key was last looked up on TMDB (null = never). Drives the '
  'least-recently-checked rotation of the trailer backfill.';

-- The sweep scans `WHERE trailer_key IS NULL ORDER BY last_trailer_check ASC
-- NULLS FIRST`; this partial index keeps that ordered scan cheap and small
-- (only rows still missing a trailer).
create index if not exists titles_trailer_recheck_idx
  on titles (last_trailer_check asc nulls first)
  where trailer_key is null;
