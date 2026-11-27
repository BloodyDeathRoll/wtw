-- Closed beta: only emails on this list can sign in (Google login stays).
--
-- Two layers:
--   1. `hook_before_user_created` (Supabase Auth "Before User Created" hook, Free plan):
--      no account is ever created for an email not on the list, so no JWT exists for it.
--      Enable once in the dashboard: Authentication → Hooks → Before User Created →
--      Postgres → public.hook_before_user_created.
--   2. /auth/callback checks `is_beta_approved` on every sign-in, so removing an email
--      from the list also locks out an account that already exists, at its NEXT sign-in.
--      A session already open keeps working until it ends. To cut someone off now, also
--      end their sessions:
--        delete from auth.sessions where user_id = (select id from auth.users where email = lower('…'));
--
-- The emails themselves are never committed (the repo is public): add them with
--   insert into public.beta_allowlist (email) values (lower('someone@example.com'));
-- in the SQL editor, or with the Table editor.

create table if not exists public.beta_allowlist (
  email      text primary key check (email = lower(email)),
  note       text,
  added_at   timestamptz not null default now()
);

-- RLS on, no policies: anon and signed-in users can't read or write it.
alter table public.beta_allowlist enable row level security;
revoke all on table public.beta_allowlist from anon, authenticated, public;

-- Read by the callback through the service role, and by the hook below.
create or replace function public.is_beta_approved(p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.beta_allowlist where email = lower(trim(p_email)));
$$;
revoke execute on function public.is_beta_approved(text) from anon, authenticated, public;
grant execute on function public.is_beta_approved(text) to service_role, supabase_auth_admin;

-- The Auth hook. `{}` lets the sign-up through; an `error` object blocks it.
create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
begin
  -- is_beta_approved is security definer, so the hook needs no grant on the table itself.
  if public.is_beta_approved(event->'user'->>'email') then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'not_approved: this email is not on the closed beta list'
  ));
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_before_user_created(jsonb) from anon, authenticated, public;
