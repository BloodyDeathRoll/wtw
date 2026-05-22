-- ============================================================
-- WTW — Scoring RPC Functions
-- Migration 0003 — depends on 0002_rec_engine.sql
-- ============================================================
-- Adds:
--   match_titles_by_narrative() → batch cosine similarity for Step 2
-- ============================================================

-- Batch cosine similarity between a user's strand_b embedding
-- and all candidate titles. Called once per recommendation request
-- (not once per title) — one SQL round-trip for all 200 candidates.
--
-- query_embedding : the user's strand_b Mistral vector (1024-dim)
-- candidate_ids   : tmdb_ids of unwatched, non-excluded titles
--
-- Returns rows only for titles that have been enriched (narrative_embedding IS NOT NULL).
-- Unenriched titles fall back to a score of 0.5 in the TypeScript caller.
--
-- Score is cosine similarity mapped to [0, 1]:
--   1.0 = identical embedding (perfect narrative match)
--   0.5 = orthogonal (no match signal)
--   0.0 = opposite (very unlikely for text embeddings)

create or replace function public.match_titles_by_narrative(
  query_embedding vector(1024),
  candidate_ids   text[]
)
returns table (
  tmdb_id text,
  score   float8
)
language sql
stable
security definer
as $$
  select
    tmdb_id,
    greatest(0, 1 - (narrative_embedding <=> query_embedding)) as score
  from public.titles
  where
    tmdb_id = any(candidate_ids)
    and narrative_embedding is not null
  order by score desc;
$$;
