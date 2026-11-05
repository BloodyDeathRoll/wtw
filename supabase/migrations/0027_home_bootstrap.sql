-- 0027 — one round trip for the home and play screens (docs/speed-plan.md, D).
--
-- The home page made 5–6 Supabase calls in sequence before it could render:
-- the open conversation, its messages, the feedback count, the conversation
-- list, the user-message count, the play state. Each is ~300 ms from the
-- Frankfurt functions to the Sydney database (measured 2026-11-05), so the
-- page waited 1.5–2 s on the database alone. The play page did three of them.
--
-- home_bootstrap() returns all of it in one call. It is `security invoker`
-- and keyed on auth.uid(): it runs with the caller's row-level policies and
-- cannot read another user. `next_session_number` is returned so that the
-- rare "no open conversation" case needs one insert, not a select first.
--
-- Rollback: drop function public.home_bootstrap(); the callers fall back to
-- the per-table queries when the function is missing.

create or replace function public.home_bootstrap()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with me as (
    select auth.uid() as id
  ),
  open_conv as (
    select c.id, c.session_number, c.stage, c.favorites
    from public.conversations c, me
    where c.user_id = me.id and c.ended_at is null
    order by c.last_active_at desc
    limit 1
  ),
  msgs as (
    select m.id, m.role, m.content
    from public.messages m
    join open_conv oc on oc.id = m.conversation_id
    order by m.created_at asc
  )
  select jsonb_build_object(
    'conversation', (select to_jsonb(oc) from open_conv oc),
    'messages', coalesce((select jsonb_agg(to_jsonb(m)) from msgs m), '[]'::jsonb),
    'next_session_number',
      coalesce((select max(c.session_number) from public.conversations c, me where c.user_id = me.id), 0) + 1,
    'feedback_count',
      (select count(*) from public.recommendation_feedback f, me where f.user_id = me.id),
    'user_message_count',
      (select count(*) from public.messages m
         join public.conversations c on c.id = m.conversation_id
         cross join me
       where c.user_id = me.id and m.role = 'user'),
    'play',
      (select jsonb_build_object('state', p.state, 'version', p.version)
         from public.play_state p, me where p.user_id = me.id)
  );
$$;

grant execute on function public.home_bootstrap() to authenticated;
revoke execute on function public.home_bootstrap() from anon, public;
