/**
 * GET /api/search?q=slow+horses — the Search screen's list (menu → Search).
 *   → { results: TitleSearchHit[] }
 *
 * Searches all of TMDB, not just our catalogue: the point is finding the show
 * someone at the office mentioned, which may be one we've never seen. Fast
 * enough to call as the user pauses typing (~0.1–0.3s from TMDB). Signed-in
 * only, so the endpoint isn't a free TMDB proxy.
 */

import { NextRequest, NextResponse } from "next/server";
import { logAuthFailure } from "@/lib/auth-guard";
import { createClient } from "@/lib/supabase/server";
import { searchTitles } from "@/lib/tmdb";

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

  try {
    return NextResponse.json({ results: await searchTitles(q) });
  } catch (e) {
    console.error("[search] TMDB failed", e);
    return NextResponse.json({ error: "Search is unavailable" }, { status: 502 });
  }
}
