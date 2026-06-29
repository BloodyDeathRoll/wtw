-- ============================================================
-- WTW — Initial Schema
-- Run this in the Supabase SQL Editor (or via supabase db push)
-- Safe to re-run — all statements are idempotent.
-- ============================================================

-- pgvector for fingerprint embeddings
create extension if not exists vector;

-- ── Users (DNA store) ────────────────────────────────────────
create table if not exists public.users (
  id          uuid references auth.users(id) on delete cascade primary key,
  created_at  timestamptz default now() not null,
  updated_at  timestamptz default now() not null,
  dna         jsonb default null  -- full DNASchema document
);

alter table public.users enable row level security;

drop policy if exists "users_select_own" on public.users;
create policy "users_select_own" on public.users
  for select using (auth.uid() = id);

drop policy if exists "users_insert_own" on public.users;
create policy "users_insert_own" on public.users
  for insert with check (auth.uid() = id);

drop policy if exists "users_update_own" on public.users;
create policy "users_update_own" on public.users
  for update using (auth.uid() = id);

-- ── Fingerprint embeddings ────────────────────────────────────
create table if not exists public.fingerprint_embeddings (
  id             uuid default gen_random_uuid() primary key,
  user_id        uuid references public.users(id) on delete cascade not null,
  embedding      vector(1024),
  taste_version  integer not null,
  created_at     timestamptz default now() not null
);

alter table public.fingerprint_embeddings enable row level security;

drop policy if exists "embeddings_select_own" on public.fingerprint_embeddings;
create policy "embeddings_select_own" on public.fingerprint_embeddings
  for select using (auth.uid() = user_id);

create index if not exists fingerprint_embeddings_ivfflat_idx
  on public.fingerprint_embeddings
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- ── Auto-provision user row on signup ────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id) values (new.id);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ── updated_at trigger ────────────────────────────────────────
create or replace function public.handle_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists users_updated_at on public.users;
create trigger users_updated_at
  before update on public.users
  for each row execute procedure public.handle_updated_at();
