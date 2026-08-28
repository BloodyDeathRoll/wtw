-- ============================================================
-- WTW — Migration 0019: served-title memory + retrieval that isn't
-- popularity-capped. Run after 0018. Safe to re-run.
-- ============================================================
--
-- Why: get_candidate_titles returns the top 200 titles by vote count that the
-- user hasn't rated. With a 17,700-title catalog that means ~17,000 titles are
-- never considered, and every regeneration re-scores the same ~165 popular
-- titles the user has already scrolled past — "the same recommendations" (see
-- docs/INTEGRATION.md §7 cause 4). Decided 2026-08-28: each batch is 80% titles
-- never served to this user, 20% titles served before but never rated, both
-- ordered by match.
--
-- 1. served_titles — what each user has actually been shown (recorded when a
--    page is served, not when a batch is generated).
-- 2. get_candidate_titles_by_narrative — a taste-driven pool: nearest titles to
--    the fingerprint embedding, excluding a key list. Pairs with the existing
--    popularity pool so "new" is new AND relevant, not just "next most voted".
-- 3. get_served_candidates — the previously-served, still-unrated pool.
-- 4. record_served_titles — upsert-increment for (1).
-- 5. match_titles_by_narrative now also returns `type`: a movie and a TV show
--    sharing a tmdb_id both came back and the caller's Map kept one score for
--    both (src/lib/title-key.ts).

-- ── 1. served_titles ──────────────────────────────────────────

create table if not exists public.served_titles (
  user_id         uuid references public.users(id) on delete cascade not null,
  tmdb_id         text not null,
  media_type      text not null check (media_type in ('movie', 'tv')),
  first_served_at timestamptz default now() not null,
  last_served_at  timestamptz default now() not null,
  times_served    integer default 1 not null,
  primary key (user_id, tmdb_id, media_type)
);

alter table public.served_titles enable row level security;

drop policy if exists "served_titles_select_own" on public.served_titles;
create policy "served_titles_select_own"
  on public.served_titles
  for select using (auth.uid() = user_id);
-- Writes go through record_served_titles (security definer) only.

create index if not exists served_titles_user_last_idx
  on public.served_titles (user_id, last_served_at desc);

-- ── 2. Taste-driven pool ───────────────────────────────────────
-- ivfflat returns the nearest rows from the probed lists and THEN applies the
-- WHERE, so with a few hundred excluded keys the default probes=1 can come
-- back short. 10 probes of 100 lists is plenty for a 150-row pool. Supabase
-- refuses `SET ivfflat.probes` on the function itself ("permission denied to
-- set parameter"), so it's a transaction-local set_config in the body, and
-- guarded — if the role can't set it we still return results, just fewer.
--
-- min_votes: cosine on these embeddings clusters tightly (a 15-vote title can
-- sit at 0.95 next to Shawshank at 0.96 — measured 2026-08-28), so without a
-- floor the taste pool fills with obscure junk the scorer then has to sink.

drop function if exists public.get_candidate_titles_by_narrative(vector, text[], text, integer, integer);

create or replace function public.get_candidate_titles_by_narrative(
  query_embedding vector(1024),
  exclude_keys    text[],                 -- '${type}:${tmdb_id}'
  title_type      text    default null,
  max_runtime     integer default null,
  pool_limit      integer default 150,
  min_votes       integer default 100
)
returns setof public.titles
language plpgsql
stable
security definer
as $$
begin
  begin
    perform set_config('ivfflat.probes', '10', true);
  exception when others then
    null;
  end;
  return query
    select *
    from public.titles t
    where
      t.enriched_at is not null
      and t.narrative_embedding is not null
      and coalesce(t.tmdb_vote_count, 0) >= min_votes
      and (t.type || ':' || t.tmdb_id) != all(coalesce(exclude_keys, '{}'::text[]))
      and (title_type is null or t.type = title_type)
      and (max_runtime is null or t.runtime_minutes is null or t.runtime_minutes <= max_runtime)
    order by t.narrative_embedding <=> query_embedding::halfvec(1024)
    limit pool_limit;
end;
$$;

-- ── 3. Previously-served, unrated pool ────────────────────────

create or replace function public.get_served_candidates(
  served_keys   text[],                   -- '${type}:${tmdb_id}'
  exclude_keys  text[],
  title_type    text    default null,
  max_runtime   integer default null,
  pool_limit    integer default 150
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
    and (type || ':' || tmdb_id) = any(coalesce(served_keys, '{}'::text[]))
    and (type || ':' || tmdb_id) != all(coalesce(exclude_keys, '{}'::text[]))
    and (title_type is null or type = title_type)
    and (max_runtime is null or runtime_minutes is null or runtime_minutes <= max_runtime)
  order by tmdb_vote_count desc nulls last
  limit pool_limit;
$$;

-- ── 4. Record a served page ───────────────────────────────────

create or replace function public.record_served_titles(
  p_user_id uuid,
  p_keys    text[]                        -- '${type}:${tmdb_id}'
)
returns void
language sql
security definer
as $$
  insert into public.served_titles (user_id, tmdb_id, media_type)
  select p_user_id, split_part(k, ':', 2), split_part(k, ':', 1)
  from unnest(coalesce(p_keys, '{}'::text[])) as k
  where split_part(k, ':', 1) in ('movie', 'tv') and split_part(k, ':', 2) <> ''
  on conflict (user_id, tmdb_id, media_type) do update
    set last_served_at = now(),
        times_served   = public.served_titles.times_served + 1;
$$;

-- ── 5. match_titles_by_narrative returns the type too ─────────
-- Return type changes, so drop first (create-or-replace can't alter it).

drop function if exists public.match_titles_by_narrative(vector, text[]);

create function public.match_titles_by_narrative(
  query_embedding vector(1024),
  candidate_ids   text[]
)
returns table (tmdb_id text, type text, score double precision)
language sql
stable
security definer
as $$
  select
    tmdb_id,
    type,
    greatest(0, 1 - (narrative_embedding <=> query_embedding::halfvec(1024))) as score
  from public.titles
  where
    tmdb_id = any(candidate_ids)
    and narrative_embedding is not null
  order by score desc;
$$;
