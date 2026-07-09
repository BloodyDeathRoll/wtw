-- ============================================================
-- WTW — Session conversations + messages
-- Safe to re-run — all statements are idempotent.
-- ============================================================

-- ── conversations ────────────────────────────────────────────
create table if not exists public.conversations (
  id              uuid default gen_random_uuid() primary key,
  user_id         uuid references public.users(id) on delete cascade not null,
  session_number  integer not null default 1,
  stage           text not null default 'onboard'
                    check (stage in ('onboard', 'welcome', 'conversation')),
  favorites       text not null default '',
  started_at      timestamptz default now() not null,
  last_active_at  timestamptz default now() not null
);

alter table public.conversations enable row level security;

drop policy if exists "conversations_select_own" on public.conversations;
create policy "conversations_select_own" on public.conversations
  for select using (auth.uid() = user_id);

drop policy if exists "conversations_insert_own" on public.conversations;
create policy "conversations_insert_own" on public.conversations
  for insert with check (auth.uid() = user_id);

drop policy if exists "conversations_update_own" on public.conversations;
create policy "conversations_update_own" on public.conversations
  for update using (auth.uid() = user_id);

create index if not exists conversations_user_recent_idx
  on public.conversations (user_id, last_active_at desc);

-- ── messages ─────────────────────────────────────────────────
create table if not exists public.messages (
  id              uuid default gen_random_uuid() primary key,
  conversation_id uuid references public.conversations(id) on delete cascade not null,
  role            text not null check (role in ('user', 'assistant')),
  content         text not null,
  created_at      timestamptz default now() not null
);

alter table public.messages enable row level security;

drop policy if exists "messages_select_own" on public.messages;
create policy "messages_select_own" on public.messages
  for select using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.user_id = auth.uid()
    )
  );

drop policy if exists "messages_insert_own" on public.messages;
create policy "messages_insert_own" on public.messages
  for insert with check (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.user_id = auth.uid()
    )
  );

create index if not exists messages_conversation_time_idx
  on public.messages (conversation_id, created_at);

-- ── Auto-bump conversations.last_active_at on new message ────
create or replace function public.bump_conversation_last_active()
returns trigger
language plpgsql
as $$
begin
  update public.conversations
    set last_active_at = now()
    where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists messages_bump_conversation on public.messages;
create trigger messages_bump_conversation
  after insert on public.messages
  for each row execute procedure public.bump_conversation_last_active();
