-- 0011 — trailer harvesting
--
-- Store the best YouTube trailer key per title (picked from TMDB's /videos
-- block during enrichment; see src/lib/tmdb.ts pickTrailerKey). Nullable: not
-- every title has a trailer, and existing rows backfill lazily via the nightly
-- catalog run + scripts/backfill-trailers.mts. The UI builds the watch/embed
-- URL from this key with youtubeTrailerUrl().

alter table titles
  add column if not exists trailer_key text;

comment on column titles.trailer_key is
  'YouTube video key of the best trailer (TMDB /videos), or null if none.';
