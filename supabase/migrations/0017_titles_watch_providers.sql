-- 0017 — "Watch on …" streaming availability
--
-- src/app/api/recommendations/generate/route.ts hardcoded `where: null` on
-- every real recommendation, so the "Watch on …" line in
-- RecommendationsView.tsx only ever rendered for the pre-first-session mock
-- list. Users saw the affordance once and never again. This column is the
-- missing data.
--
-- Shape: `{ "<ISO-3166-1 region>": ["Netflix", "Hulu"] }`, flatrate
-- (subscription) providers only, in TMDB's display_priority order. Rent/buy is
-- deliberately excluded — "Watch on Apple TV+" means it is included with a
-- subscription, and mixing in a £3.49 rental makes the line a lie.
--
-- Only the regions in WATCH_REGIONS (grow-catalog.mts) are stored, not all ~200
-- TMDB returns: at 15,900 titles the full map is tens of MB of jsonb for data
-- the UI reads one region of. `{}` is a real answer (checked, streaming
-- nowhere) and is distinct from NULL (never checked).
--
-- ⚠️ TMDB sources this from JustWatch and requires visible attribution
-- wherever it is displayed. See RecommendationsView.tsx.

alter table titles
  add column if not exists watch_providers jsonb;

alter table titles
  add column if not exists last_provider_check timestamptz;

comment on column titles.watch_providers is
  'Flatrate streaming providers by region, e.g. {"US":["Netflix"]}. '
  'Null = never checked; {} = checked, streaming nowhere. Source: TMDB '
  '/watch/providers (data by JustWatch — attribution required on display).';

comment on column titles.last_provider_check is
  'When watch_providers was last looked up (null = never). Drives the '
  'least-recently-checked rotation of the provider backfill.';

-- Same rotation as 0012/0016: the sweep scans ORDER BY last_provider_check ASC
-- NULLS FIRST. Unlike those two this index is NOT partial on a NULL column —
-- availability changes when licensing deals lapse, so a title that HAS
-- providers must still be re-checked periodically, and a `where
-- watch_providers is null` index would hide exactly those rows.
create index if not exists titles_provider_recheck_idx
  on titles (last_provider_check asc nulls first);
