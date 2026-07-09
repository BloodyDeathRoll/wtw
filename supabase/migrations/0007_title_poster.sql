-- ============================================================
-- WTW — Migration 0007: title poster path
-- Run after 0002_rec_engine.sql (adds a column to public.titles)
-- Safe to re-run — ADD COLUMN IF NOT EXISTS.
-- ============================================================
--
-- Stores the TMDB *relative* poster path (e.g. '/abc123.jpg').
-- The full image URL is built in the app via tmdbPosterUrl() in
-- src/lib/tmdb.ts, so the CDN base + size live in one place and can
-- change without a data migration.
--
-- Nullable: not every TMDB title has a poster; the UI falls back to
-- its motif/palette tile when poster_url resolves to null.

alter table public.titles
  add column if not exists poster_path text;
