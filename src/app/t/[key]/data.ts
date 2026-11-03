import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import {
  getMovie,
  getTV,
  primaryWatchProvider,
  tmdbPosterUrl,
  youtubeTrailerUrl,
  type WatchProviderMap,
} from "@/lib/tmdb";
import type { Recommendation } from "@/types/recommendation";

/** The region the catalog's streaming line is stored for — the same one the feed reads
 *  (WATCH_REGION in src/app/api/recommendations/generate/route.ts). */
const WATCH_REGION = "US";

export interface SharedTitle {
  /** In the watchlist's card shape, so "Save" stores exactly what the feed would. */
  rec: Recommendation;
  synopsis: string;
}

/** "movie-9909" → the title's `type:tmdb_id` parts; null for anything else. */
export function parseShareKey(key: string): { type: "movie" | "tv"; tmdb_id: string } | null {
  const m = /^(movie|tv)-(\d+)$/.exec(key);
  return m ? { type: m[1] as "movie" | "tv", tmdb_id: m[2] } : null;
}

/**
 * One title for the shared-link page and its preview image: the catalog row
 * when we have it (cheap, and it carries the streaming line), else TMDB.
 */
export async function loadSharedTitle(key: string): Promise<SharedTitle | null> {
  const parsed = parseShareKey(key);
  if (!parsed) return null;
  const { type, tmdb_id } = parsed;

  const { data: row } = await createServiceClient()
    .from("titles")
    .select("title, synopsis, release_year, runtime_minutes, tmdb_rating, poster_path, trailer_key, watch_providers")
    .eq("tmdb_id", tmdb_id)
    .eq("type", type)
    .maybeSingle();

  const t = row ?? (type === "movie" ? await getMovie(tmdb_id) : await getTV(tmdb_id));
  if (!t) return null;

  const runtime = (t.runtime_minutes as number | null) ?? null;
  // The feed card's metadata line (toUIRecommendations in the generate route).
  const meta =
    type === "movie"
      ? runtime ? `${Math.floor(runtime / 60)}h ${runtime % 60}m` : "Film"
      : runtime ? `~${runtime}m episodes` : "Series";

  return {
    synopsis: (t.synopsis as string | null) ?? "",
    rec: {
      id: `${type}:${tmdb_id}`,
      title: t.title as string,
      type,
      year: (t.release_year as number | null) ?? 0,
      poster_url: tmdbPosterUrl(t.poster_path as string | null),
      trailer_url: youtubeTrailerUrl(t.trailer_key as string | null),
      meta,
      rating: (t.tmdb_rating as number | null) ?? 0,
      // No "% match" claim: the page doesn't score the title for its viewer.
      match: 0,
      reason: "Shared by a friend",
      where: row
        ? primaryWatchProvider(row.watch_providers as WatchProviderMap | null, WATCH_REGION)
        : null,
      motif: "dot",
      palette: ["#1E1E22", "#D49B3A"],
    },
  };
}
