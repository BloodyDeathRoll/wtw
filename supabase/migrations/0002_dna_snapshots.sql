-- ============================================================
-- WTW — Migration 0002: DNA Snapshots + Embedding Upsert Fix
-- Run after 0001_initial.sql
-- ============================================================

-- ── DNA Snapshots ─────────────────────────────────────────────
-- Stores the last 5 immutable fingerprint versions per user.
-- Used for rollback, explainability ("why did it recommend X?"),
-- and the "fingerprint versioning" product feature.
--
-- Pruning (keeping only 5) is handled in application code
-- (src/modules/dna/snapshot.ts) — not via DB triggers.

create table if not exists public.dna_snapshots (
  id             uuid        default gen_random_uuid() primary key,
  user_id        uuid        references public.users(id) on delete cascade not null,
  taste_version  integer     not null,
  snapshot       jsonb       not null,  -- full DNASchema document at this version
  created_at     timestamptz default now() not null,

  -- One snapshot per taste_version per user — prevents double-writes on retries
  unique (user_id, taste_version)
);

alter table public.dna_snapshots enable row level security;

-- Users can read their own snapshots (for rollback UI)
create policy "snapshots_select_own" on public.dna_snapshots
  for select using (auth.uid() = user_id);

-- Service role handles all writes — no direct client inserts
-- (writer.ts uses the service role key via createClient())

-- Index for fast "get last N snapshots for user" queries
create index if not exists dna_snapshots_user_version_idx
  on public.dna_snapshots (user_id, taste_version desc);


-- ── Fingerprint Embeddings: add UNIQUE on user_id ─────────────
-- Required for the ON CONFLICT (user_id) upsert in embedding.ts.
-- One live embedding row per user — old ones are overwritten, not appended.
--
-- Skip if the constraint already exists (idempotent).

do $$
begin
  if not exists (
    select 1
    from   pg_constraint
    where  conname = 'fingerprint_embeddings_user_id_key'
  ) then
    alter table public.fingerprint_embeddings
      add constraint fingerprint_embeddings_user_id_key unique (user_id);
  end if;
end
$$;
