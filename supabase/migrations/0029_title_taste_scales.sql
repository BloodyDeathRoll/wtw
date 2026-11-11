-- 0029 — titles: the 11 taste scales on every catalogue title (docs/plan/PLAN.md, P1-D1).
--
-- Written by the catalogue scorer (P1-D2), read by the taste model (P1-D4)
-- and formula v2 (P1-E3). All nullable: a title is unscored until D2 reaches it.
--   taste_raw      the AI's −5..5 per AI scale, plus `confirmed` (hinted genres it confirmed)
--   taste_scales   final −1..1 per scale (src/lib/taste-scales/normalise.ts;
--                  the 980 game titles keep their titles.json values verbatim)
--   game_genres    the 13 game genres (src/app/play/lib/genres.ts)
--   taste_vec      tasteFeatures(row), 25 floats (src/lib/taste-scales/features.ts)
--   taste_version  TASTE_FEATURE_VERSION the vector was built with
--
-- Same pgvector as 0018 (extension in public, 0001). No index: the model
-- scores with an exact scan; 35k × 25 floats is small. Add HNSW
-- (vector_ip_ops) only if EXPLAIN ANALYZE says it's needed.
--
-- Rollback: alter table public.titles drop column taste_raw, drop column
-- taste_scales, drop column game_genres, drop column taste_vec, drop column taste_version;

alter table public.titles
  add column if not exists taste_raw     jsonb,
  add column if not exists taste_scales  jsonb,
  add column if not exists game_genres   text[],
  add column if not exists taste_vec     vector(25),
  add column if not exists taste_version smallint;

comment on column public.titles.taste_vec is
  'Taste model inputs, 25 floats (src/lib/taste-scales/features.ts), built at taste_version. P1-D1.';
