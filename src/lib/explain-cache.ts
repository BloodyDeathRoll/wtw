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
