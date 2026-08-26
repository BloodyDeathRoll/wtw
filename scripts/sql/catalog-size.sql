-- Catalog storage vs the Supabase free tier (500 MB).
-- Paste into the Supabase SQL editor. Read-only, creates nothing.
--
-- Why this exists: Dream's assignments/wtw-catalog/manifest.yaml raised
-- target_catalog 15000 -> 35000 on 2026-08-25 against an ARITHMETIC estimate
-- of ~10.2 KB/title (4.1 KB vector(1024) in the row + 4.1 KB for the same
-- vector again in the ivfflat index + ~1.7 KB text/JSONB measured over 200
-- live rows). This replaces that estimate with a measurement.

with t as (
  select
    pg_database_size(current_database())                as db_bytes,
    pg_total_relation_size('public.titles')             as titles_total,
    pg_relation_size('public.titles')                   as titles_heap,
    pg_indexes_size('public.titles')                    as titles_idx,
    (select count(*) from public.titles)                as rows
)
select
  pg_size_pretty(db_bytes)                                        as db_total,
  round(100.0 * db_bytes / (500*1024*1024), 1)                    as pct_of_500mb,
  rows                                                            as titles_rows,
  pg_size_pretty(titles_total)                                    as titles_total,
  pg_size_pretty(titles_heap)                                     as titles_heap,
  pg_size_pretty(titles_idx)                                      as titles_indexes,
  pg_size_pretty(titles_total - titles_heap - titles_idx)         as titles_toast_vectors,
  pg_size_pretty(titles_total / greatest(rows,1))                 as per_title,
  -- what the catalog would weigh at the new target, holding per-title cost flat
  pg_size_pretty(db_bytes + (titles_total / greatest(rows,1)) * (35000 - rows))
                                                                  as projected_at_35k,
  round(100.0 * (db_bytes + (titles_total / greatest(rows,1)) * (35000 - rows))
        / (500*1024*1024), 1)                                     as projected_pct_of_500mb,
  -- how many titles fit before 500 MB, at the measured per-title cost
  ((500*1024*1024 - db_bytes) / greatest(titles_total / greatest(rows,1), 1)) + rows
                                                                  as max_titles_at_500mb
from t;
