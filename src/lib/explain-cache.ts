// In-session cache for "Why this pick" breakdowns.
//
// The /api/recommendations/explain payload is kept only for as long as the app
// is running so re-opening the same "Why" during a session doesn't re-hit the
// server. It lives in sessionStorage, so it's cleared automatically when the
// app/tab is closed and starts empty on relaunch — no stale rationale carries
// across sessions.
//
// Keyed by the recommendation id ("type:tmdb_id").

import type { RecommendationResult } from "@/types/dna";

const STORAGE_KEY = "wtw_explain_cache";

// The shape returned by GET /api/recommendations/explain.
export interface ExplainData {
  tmdb_id: string;
  title: string;
  explanation: string;
  reason_payload: RecommendationResult["reason_payload"];
  is_stretch_pick: boolean;
}

type CacheMap = Record<string, ExplainData>;

function readCache(): CacheMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CacheMap) : {};
  } catch {
    return {};
  }
}

function writeCache(map: CacheMap): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Quota exceeded / storage disabled — caching is best-effort.
  }
}

/** Returns a breakdown cached earlier this session, or null. */
export function getCachedExplain(key: string): ExplainData | null {
  return readCache()[key] ?? null;
}

/** Cache a freshly-fetched breakdown for the rest of this session. */
export function setCachedExplain(key: string, data: ExplainData): void {
  const map = readCache();
  map[key] = data;
  writeCache(map);
}

// ─────────────────────────────────────────────
// Today's breakdown (v3 M2, FOR-YOU.md DEC-9)
// ─────────────────────────────────────────────

/** Session-cache key for a breakdown scored today, kept apart from saved snapshots. */
export const freshKey = (id: string) => `fresh:${id}`;

/**
 * Today's breakdown for one title, from the engine (`GET
 * /api/recommendations/score`, M1): the same shape as `/explain`. Null when
 * the engine won't score it (not in the catalogue, a profile still on
 * cold-start picks) or the call fails: the card page then falls back.
 */
export async function fetchFreshExplain(
  type: "movie" | "tv",
  tmdbId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ExplainData | null> {
  try {
    const res = await fetchImpl(
      `/api/recommendations/score?type=${type}&tmdb_id=${encodeURIComponent(tmdbId)}`,
    );
    if (!res.ok) return null;
    const d = (await res.json()) as { scored?: boolean } & Partial<ExplainData>;
    if (!d.scored || !d.reason_payload) return null;
    return {
      tmdb_id: d.tmdb_id ?? tmdbId,
      title: d.title ?? "",
      explanation: d.explanation ?? "",
      reason_payload: d.reason_payload,
      is_stretch_pick: false,
    };
  } catch {
    return null;
  }
}

/**
 * A snapshot saved before formula v2 has no `taste`, and the breakdown then
 * draws its old guessed bars (the match itself, × 0.88, a fixed 88%). On the
 * card page such a snapshot shows the Why and the Crew only (WATCHLIST.md
 * DEC-2): an empty `taste` draws no bars, and the crew still lists.
 */
export function withoutGuessedBars(d: ExplainData): ExplainData {
  const p = d.reason_payload as RecommendationResult["reason_payload"] & { taste?: unknown };
  if (p?.taste) return d;
  return { ...d, reason_payload: { ...p, taste: { like: [] } } as RecommendationResult["reason_payload"] };
}

/**
 * Today's match for several titles (v3 Q7, `POST /api/recommendations/score`),
 * keyed "type:tmdb_id". A title the engine won't score is absent; a failed
 * call gives null, so the caller can ask again later. Either way it shows
 * what it has (the saved match on a Watchlist row, nothing on a Search result).
 */
export async function fetchMatches(
  titles: { type: "movie" | "tv"; tmdb_id: string }[],
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, number> | null> {
  if (!titles.length) return {};
  try {
    const res = await fetchImpl("/api/recommendations/score", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ titles }),
    });
    if (!res.ok) return null;
    const d = (await res.json()) as { matches?: Record<string, number> };
    return d.matches ?? {};
  } catch {
    return null;
  }
}
