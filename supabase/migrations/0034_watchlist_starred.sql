-- 0034 — Watchlist v3 (docs/plan/v3/WATCHLIST.md DEC-4): a star to prioritise.
--
-- A starred title sits at the top of the Watchlist. The flag lives on the
-- saved entry itself, next to `rating`, so it follows the login across
-- devices like the rest of the list (src/lib/watchlist.ts keeps the
-- localStorage cache in step, optimistically, the way `rating` is).
--
-- Additive and idempotent: safe to re-run. Rollback:
--   alter table public.watchlist_entries drop column starred;

alter table public.watchlist_entries
  add column if not exists starred boolean not null default false;
