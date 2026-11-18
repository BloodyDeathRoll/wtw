/**
 * GET /api/search?q=slow+horses — the Search screen's list (menu → Search).
 *   → { results: SearchHit[] } — titles, and directors and actors (since 2026-11-05)
 *
 * Searches all of TMDB, not just our catalogue: the point is finding the show
 * someone at the office mentioned, which may be one we've never seen. Fast
 * enough to call as the user pauses typing (~0.1–0.3s from TMDB). Signed-in
 * only, so the endpoint isn't a free TMDB proxy.
 *
 * SEARCH_V3 (v3 Q4): our catalogue answers too, from the second letter and
 * through a one-word typo, merged with TMDB's whole-word answer
 * (src/lib/search-catalogue.ts). If either side fails, the other one's list is
 * served; with the flag off, this is exactly today's TMDB search.
 */

import { NextRequest, NextResponse } from "next/server";
import { logAuthFailure } from "@/lib/auth-guard";
import { createClient } from "@/lib/supabase/server";
import { searchTitles } from "@/lib/tmdb";
import { searchV3Enabled } from "@/lib/flags";
import { catalogueCandidates, mergeSearch, voteQuantiles } from "@/lib/search-catalogue";

// Longer than any real title; only stops abuse.
const MAX_QUERY = 100;

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  // getClaims verifies the session token locally (no round trip to Supabase
  // Auth, unlike getUser): about 0.5s less per search, measured 2026-11-04.
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) {
    logAuthFailure("/api/search");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, MAX_QUERY);
  if (q.length < 2) return NextResponse.json({ results: [] });

  if (searchV3Enabled()) return searchV3(q);

  try {
    return NextResponse.json({ results: await searchTitles(q, 6, { people: true }) });
  } catch (e) {
    console.error("[search] TMDB failed", e);
    return NextResponse.json({ error: "Search is unavailable" }, { status: 502 });
  }
}

async function searchV3(q: string) {
  const t0 = Date.now();
  let catalogueMs = 0;
  const [tmdb, catalogue, quantiles] = await Promise.allSettled([
    searchTitles(q, 12, { people: true, withVotes: true }),
    catalogueCandidates(q).finally(() => { catalogueMs = Date.now() - t0; }),
    voteQuantiles(),
  ]);
  if (tmdb.status === "rejected") console.error("[search] TMDB failed", tmdb.reason);
  if (catalogue.status === "rejected") console.error("[search] catalogue failed", catalogue.reason);
  if (tmdb.status === "rejected" && catalogue.status === "rejected") {
    return NextResponse.json({ error: "Search is unavailable" }, { status: 502 });
  }
  const results = mergeSearch(
    q,
    tmdb.status === "fulfilled" ? tmdb.value : [],
    catalogue.status === "fulfilled" ? catalogue.value : [],
    quantiles.status === "fulfilled" ? quantiles.value : {},
  );
  console.log(`[search] v3 "${q.length}ch" ${results.length} results · catalogue ${catalogueMs}ms · total ${Date.now() - t0}ms`);
  return NextResponse.json({ results });
}
