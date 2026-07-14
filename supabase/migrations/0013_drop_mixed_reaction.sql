-- ============================================================
-- WTW — Migration 0013: drop the "mixed" reaction level
-- Run after 0009_feedback_reaction_range.sql. Safe to re-run.
-- ============================================================
--
-- Product decision: the reaction picker offers only loved / liked / disliked
-- (plus the separate "Remove" suppression action). "mixed" carried no useful
-- taste signal, so it is retired from the Reaction enum (src/types/dna.ts),
-- the session analyzer, and the scoring maps.
--
-- 1. Fold every existing 'mixed' row into 'disliked' (ambivalent → negative).
-- 2. Narrow the check constraint so 'mixed' can never be written again.

update public.recommendation_feedback
   set rating = 'disliked'
 where rating = 'mixed';

do $$
begin
  if exists (
    select 1 from pg_constraint where conname = 'recommendation_feedback_rating_check'
  ) then
    alter table public.recommendation_feedback
      drop constraint recommendation_feedback_rating_check;
  end if;

  alter table public.recommendation_feedback
    add constraint recommendation_feedback_rating_check
    check (rating in ('loved', 'liked', 'disliked'));
end
$$;
