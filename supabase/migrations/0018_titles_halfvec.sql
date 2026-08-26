-- 0018 — narrative_embedding: vector(1024) → halfvec(1024)
--
-- Measured 2026-08-26 (scripts/sql/catalog-size.sql, live): the database was
-- 281 MB of the free tier's 500 MB at 15,900 titles — 16 KB/title — and the
-- 35,000 target projected to 574 MB, which puts the project in READ-ONLY mode.
-- 125 MB of that was idx_titles_narrative_embedding alone: a vector(1024) is
-- 4,104 bytes and two do not fit in an 8 KB page, so ivfflat spends a whole
-- page per vector. REINDEX freed 5 MB; it is geometry, not bloat.
--
-- halfvec stores each dimension as a 2-byte float: 2,056 bytes per vector,
-- three per index page, and the TOASTed row copy halves too. Expected
-- ~16 → ~9 KB/title, 35k ≈ 330 MB. Cosine ranking is unaffected at this
-- precision. Requires pgvector ≥ 0.7 (live: 0.8.0).
--
-- Callers do not change: match_titles_by_narrative keeps its vector(1024)
-- parameter (supabase-js sends a JSON array, which both types parse) and
-- casts inside. The enrichment write (enrich-title-narrative.ts) sends the
-- same JSON array; halfvec's input accepts it.
--
-- ⚠️ ALTER TYPE rewrites the table and the index cannot be carried across
-- opclasses, so: drop index → alter → recreate. Rebuilding ivfflat needs
-- maintenance_work_mem above the Nano default of 32 MB (k-means asked for
-- 45 MB on 15,900 rows) — hence the SET. Run outside peak; the table is
-- locked for the rewrite (~30 s at 15,900 rows).

set maintenance_work_mem = '96MB';

drop index if exists public.idx_titles_narrative_embedding;
-- Leftover from a REINDEX CONCURRENTLY that died on maintenance_work_mem
-- (2026-08-26). Invalid, still vector_cosine_ops, and ALTER TYPE tries to
-- rebuild it — "operator class vector_cosine_ops does not accept halfvec".
drop index if exists public.idx_titles_narrative_embedding_ccnew;

alter table public.titles
  alter column narrative_embedding type halfvec(1024)
  using narrative_embedding::halfvec(1024);

create index idx_titles_narrative_embedding
  on public.titles using ivfflat (narrative_embedding halfvec_cosine_ops)
  with (lists = 100);

create or replace function public.match_titles_by_narrative(
  query_embedding vector(1024),
  candidate_ids   text[]
)
returns table (tmdb_id text, score double precision)
language sql
stable
security definer
as $$
  select
    tmdb_id,
    greatest(0, 1 - (narrative_embedding <=> query_embedding::halfvec(1024))) as score
  from public.titles
  where
    tmdb_id = any(candidate_ids)
    and narrative_embedding is not null
  order by score desc;
$$;

comment on column public.titles.narrative_embedding is
  'Mistral 1024-dim narrative embedding, half precision (0018). Written by '
  'enrich-title-narrative.ts as a JSON array; compared via match_titles_by_narrative.';
