-- ============================================================
-- WTW — Migration 0009: recommendation_feedback rating → full Reaction enum
-- Run after 0005_recommendation_feedback.sql. Safe to re-run.
-- ============================================================
--
-- The rec cards moved from binary Seen&liked / Don't-like to the four-level
-- reaction picker (loved / liked / mixed / disliked) — the same Reaction enum
-- the DNA contract and scoring pipeline already use. Widen the check
-- constraint so all four land in the raw feedback stream. Existing
-- 'liked'/'disliked' rows remain valid.

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
    check (rating in ('loved', 'liked', 'mixed', 'disliked'));
end
$$;
