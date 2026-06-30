-- ============================================================
-- WTW — Recommendation Engine Tables
-- Migration 0002 — depends on 0001_initial.sql
-- Safe to re-run — all statements are idempotent.
-- ============================================================

-- ── Titles cache ─────────────────────────────────────────────

create table if not exists public.titles (
  id                  serial primary key,
  tmdb_id             text        not null unique,
  title               text        not null,
  type                text        not null check (type in ('movie', 'tv')),
  synopsis            text,
  genres              jsonb       not null default '[]'::jsonb,
  release_year        integer,
  runtime_minutes     integer,
  tmdb_rating         float,
  tmdb_vote_count     integer,
  omdb_rating         float,
  crew                jsonb       not null default '{}'::jsonb,
  pacing_tag          text        check (pacing_tag in ('slow_burn', 'moderate', 'high_octane')),
  tone_tags           jsonb       not null default '[]'::jsonb,
  narrative_metadata  jsonb       not null default '{}'::jsonb,
  narrative_embedding vector(1024),
  enriched_at         timestamptz,
  created_at          timestamptz not null default now()
);

alter table public.titles enable row level security;

drop policy if exists "titles_select_authenticated" on public.titles;
create policy "titles_select_authenticated"
  on public.titles for select using (true);

drop policy if exists "titles_insert_service" on public.titles;
create policy "titles_insert_service"
  on public.titles for insert
  with check (auth.role() = 'service_role');

drop policy if exists "titles_update_service" on public.titles;
create policy "titles_update_service"
  on public.titles for update
  using (auth.role() = 'service_role');

create index if not exists idx_titles_tmdb_id         on public.titles (tmdb_id);
create index if not exists idx_titles_type             on public.titles (type);
create index if not exists idx_titles_release_year     on public.titles (release_year desc);
create index if not exists idx_titles_needs_enrichment on public.titles (created_at asc) where enriched_at is null;
create index if not exists idx_titles_narrative_embedding
  on public.titles using ivfflat (narrative_embedding vector_cosine_ops) with (lists = 100);


-- ── Crew members cache ───────────────────────────────────────

create table if not exists public.crew_members (
  id                  serial primary key,
  tmdb_person_id      text        not null unique,
  name                text        not null,
  primary_role        text        check (primary_role in ('director', 'writer', 'cinematographer', 'actor')),
  lineage_influences  jsonb       not null default '{}'::jsonb,
  enriched_at         timestamptz,
  created_at          timestamptz not null default now()
);

alter table public.crew_members enable row level security;

drop policy if exists "crew_select_authenticated" on public.crew_members;
create policy "crew_select_authenticated"
  on public.crew_members for select using (true);

drop policy if exists "crew_insert_service" on public.crew_members;
create policy "crew_insert_service"
  on public.crew_members for insert
  with check (auth.role() = 'service_role');

drop policy if exists "crew_update_service" on public.crew_members;
create policy "crew_update_service"
  on public.crew_members for update
  using (auth.role() = 'service_role');

create index if not exists idx_crew_tmdb_person_id    on public.crew_members (tmdb_person_id);
create index if not exists idx_crew_needs_enrichment  on public.crew_members (created_at asc) where enriched_at is null;


-- ── Enrichment queue view ────────────────────────────────────

create or replace view public.titles_pending_enrichment as
  select tmdb_id, title, type, synopsis, genres, crew, created_at
  from public.titles
  where enriched_at is null
  order by created_at asc;


-- ── Candidate generation function ───────────────────────────

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
