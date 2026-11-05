-- 0028 — home_bootstrap(): the chat transcript is ordered inside the aggregate.
--
-- 0027 ordered the messages in a CTE and aggregated them afterwards. An
-- `order by` inside a CTE is not guaranteed to survive `jsonb_agg` — a plan
-- change could reorder a transcript. The order now lives in the aggregate
-- (`jsonb_agg(... order by created_at, id)`); `id` makes ties deterministic.
-- Everything else is as in 0027.
--
-- Rollback: re-run 0027 (same signature, same grants).

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
  )
  select jsonb_build_object(
    'conversation', (select to_jsonb(oc) from open_conv oc),
    'messages', coalesce(
      (select jsonb_agg(
         jsonb_build_object('id', m.id, 'role', m.role, 'content', m.content)
         order by m.created_at, m.id)
       from public.messages m
       join open_conv oc on oc.id = m.conversation_id),
      '[]'::jsonb),
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
