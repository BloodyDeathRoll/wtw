-- 0025 — index the composite title key the candidate RPCs match on.
--
-- get_served_candidates filters `(type || ':' || tmdb_id) = any(served_keys)`
-- over the whole catalog (34k rows) with no index on that expression: 7 s cold
-- with 49 keys, measured 2026-10-21, and on a user's 15th rating it hit the
-- statement timeout and sank the whole generation. The expression index lets
-- `= any(...)` probe instead of scan. (`!= all(...)` exclusions can't use an
-- index and don't need one — they filter a vote-ordered scan that stops at
-- its LIMIT.)
--
-- The expression must match the RPC's text exactly: see
-- 0021_titles_language_keywords.sql, get_served_candidates.

create index if not exists idx_titles_type_tmdb_key
  on public.titles ((type || ':' || tmdb_id));
