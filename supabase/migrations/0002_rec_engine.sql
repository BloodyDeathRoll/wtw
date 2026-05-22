-- ============================================================
-- WTW — Recommendation Engine Tables
-- Migration 0002 — depends on 0001_initial.sql
-- ============================================================
-- Adds:
--   public.titles          → TMDB content cache + narrative embeddings
--   public.crew_members    → TMDB person cache + lineage graph
--   get_candidate_titles() → Step 1 helper (hard-filter unwatched/excluded)
--   titles_pending_enrichment → enrichment queue view
--
-- RLS convention (content tables):
--   SELECT: any authenticated user (content is not private)
--   INSERT / UPDATE: service role only (server-side API routes)
-- ============================================================


-- ── Titles cache ─────────────────────────────────────────────

create table if not exists public.titles (
  id                  serial primary key,

  -- TMDB identity
  tmdb_id             text        not null unique,
  title               text        not null,
  type                text        not null check (type in ('movie', 'tv')),
  synopsis            text,
  genres              jsonb       not null default '[]'::jsonb,
  -- genres shape: [{ "id": 28, "name": "Action" }]

  release_year        integer,
  runtime_minutes     integer,

  -- External ratings (normalized 0.0 – 1.0)
  tmdb_rating         float,
  tmdb_vote_count     integer,
  omdb_rating         float,
  -- omdb_rating = weighted average of RT + Metascore, normalized

  -- Crew snapshot (denormalized for fast scoring — no join needed)
  crew                jsonb       not null default '{}'::jsonb,
  -- crew shape:
  -- {
  --   "directors":       [{ "tmdb_person_id": "string", "name": "string" }],
  --   "writers":         [{ "tmdb_person_id": "string", "name": "string" }],
  --   "cinematographers":[{ "tmdb_person_id": "string", "name": "string" }],
  --   "cast":            [{ "tmdb_person_id": "string", "name": "string", "order": 0 }]
  -- }

  -- LLM-extracted narrative metadata (set by enrichTitleWithNarrative)
  pacing_tag          text        check (pacing_tag in ('slow_burn', 'moderate', 'high_octane')),
  tone_tags           jsonb       not null default '[]'::jsonb,
  -- tone_tags shape: ["cynical", "dark", "warm", ...]

  narrative_metadata  jsonb       not null default '{}'::jsonb,
  -- narrative_metadata is a strand_b-aligned object:
  -- {
  --   "moral_ambiguity":      { "value": "high", "confidence": 0.8 },
  --   "narrative_complexity": { "value": "medium_high", "confidence": 0.7 },
  --   "emotional_demand":     { "value": "medium", "confidence": 0.6 },
  --   "originality_weight":   { "value": 0.8, "confidence": 0.7 },
  --   "humor_style":          { "value": "dry", "confidence": 0.5 },
  --   "protagonist_type":     { "value": "anti_hero", "confidence": 0.8 },
  --   "ensemble_vs_solo":     { "value": "strong_ensemble", "confidence": 0.9 }
  -- }

  narrative_embedding vector(1024),
  -- Mistral embed of narrative_metadata — used for pgvector cosine similarity
  -- against the user's strand_b embedding (fingerprint_embeddings table)

  enriched_at         timestamptz,
  -- NULL = pending LLM enrichment. Set by enrichTitleWithNarrative().
  -- The nightly cron queries WHERE enriched_at IS NULL.

  created_at          timestamptz not null default now()
);

alter table public.titles enable row level security;

create policy "titles_select_authenticated"
  on public.titles for select
  using (true);
  -- Content metadata is not private — any authenticated call can read it.
  -- Supabase anon key requests are filtered by middleware before reaching here.

create policy "titles_insert_service"
  on public.titles for insert
  with check (auth.role() = 'service_role');

create policy "titles_update_service"
  on public.titles for update
  using (auth.role() = 'service_role');

-- Standard lookup
create index if not exists idx_titles_tmdb_id
  on public.titles (tmdb_id);

-- Candidate generation filters
create index if not exists idx_titles_type
  on public.titles (type);

create index if not exists idx_titles_release_year
  on public.titles (release_year desc);

-- Enrichment queue — partial index makes the nightly cron query instant
create index if not exists idx_titles_needs_enrichment
  on public.titles (created_at asc)
  where enriched_at is null;

-- pgvector cosine similarity for narrative_match_score (Step 2, 30% weight)
-- ivfflat is appropriate for our scale; switch to hnsw if title count > 1M
create index if not exists idx_titles_narrative_embedding
  on public.titles
  using ivfflat (narrative_embedding vector_cosine_ops)
  with (lists = 100);


-- ── Crew members cache ───────────────────────────────────────

create table if not exists public.crew_members (
  id                  serial primary key,

  tmdb_person_id      text        not null unique,
  name                text        not null,
  primary_role        text        check (primary_role in ('director', 'writer', 'cinematographer', 'actor')),

  lineage_influences  jsonb       not null default '{}'::jsonb,
  -- lineage_influences shape:
  -- {
  --   "influences": [
  --     { "id": "tmdb_person_id", "name": "string", "relationship": "string" }
  --   ],
  --   "influenced_by": [
  --     { "id": "tmdb_person_id", "name": "string", "relationship": "string" }
  --   ]
  -- }
  -- Used by lineage-boost.ts for 2-degree traversal.
  -- relationship examples: "cinematographer", "writer_disciple", "frequent_collaborator"

  enriched_at         timestamptz,
  -- NULL = lineage not yet built. Set by buildLineageGraph().

  created_at          timestamptz not null default now()
);

alter table public.crew_members enable row level security;

create policy "crew_select_authenticated"
  on public.crew_members for select
  using (true);

create policy "crew_insert_service"
  on public.crew_members for insert
  with check (auth.role() = 'service_role');

create policy "crew_update_service"
  on public.crew_members for update
  using (auth.role() = 'service_role');

create index if not exists idx_crew_tmdb_person_id
  on public.crew_members (tmdb_person_id);

create index if not exists idx_crew_needs_enrichment
  on public.crew_members (created_at asc)
  where enriched_at is null;


-- ── Enrichment queue view ────────────────────────────────────
-- Used by runNightlyEnrichment() to find titles that need LLM processing.
-- Returns only the columns needed to call enrichTitleWithNarrative().

create or replace view public.titles_pending_enrichment as
  select
    tmdb_id,
    title,
    type,
    synopsis,
    genres,
    crew,
    created_at
  from public.titles
  where enriched_at is null
  order by created_at asc;


-- ── Candidate generation function ───────────────────────────
-- Called by Step 1 of the recommendation pipeline.
-- Returns up to 200 enriched, unwatched, non-excluded titles.
--
-- Parameters:
--   watched_ids   text[]   — tmdb_ids already in user's signals array
--   excluded_ids  text[]   — tmdb_ids + genre names from exclusion_rules
--   title_type    text     — 'movie' | 'tv' | null (both)
--   max_runtime   integer  — session filter (e.g. "something short" → 100)

create or replace function public.get_candidate_titles(
  watched_ids   text[],
  excluded_ids  text[],
  title_type    text    default null,
  max_runtime   integer default null
)
returns setof public.titles
language sql
stable
security definer
as $$
  select *
  from public.titles
  where
    enriched_at is not null
    and tmdb_id != all(watched_ids)
    and tmdb_id != all(coalesce(excluded_ids, '{}'::text[]))
    and (title_type is null or type = title_type)
    and (max_runtime is null or runtime_minutes is null or runtime_minutes <= max_runtime)
  order by tmdb_vote_count desc nulls last
  limit 200;
$$;


-- ── Nightly enrichment cron ──────────────────────────────────
-- The enrichment itself (LLM calls + Mistral embeddings) runs in
-- Next.js at POST /api/cron/enrich — not in SQL.
--
-- Two options to trigger it:
--
-- Option A — Vercel Cron (recommended for Next.js):
--   Add to vercel.json:
--   { "crons": [{ "path": "/api/cron/enrich", "schedule": "0 3 * * *" }] }
--
-- Option B — Supabase pg_cron + pg_net (if Vercel Cron unavailable):
--   Requires pg_cron and pg_net extensions enabled in Supabase dashboard.
--
--   create extension if not exists pg_net;
--
--   select cron.schedule(
--     'nightly-title-enrichment',
--     '0 3 * * *',
--     $$
--       select net.http_post(
--         url     := current_setting('app.base_url') || '/api/cron/enrich',
--         headers := jsonb_build_object(
--           'Authorization', 'Bearer ' || current_setting('app.cron_secret')
--         )
--       );
--     $$
--   );
--
--   Set app.base_url and app.cron_secret in Supabase Dashboard →
--   Project Settings → Database → Configuration → Custom config.
