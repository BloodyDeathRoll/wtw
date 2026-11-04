/**
 * GET /api/search/title?key=tv-95480 — the card for one search result.
 *   → { rec: Recommendation, synopsis: string }
 *
 * The same lookup as a shared link's page (src/app/t/[key]/data.ts): our
 * catalogue row when we have the title, else TMDB, in the watchlist's card
 * shape so "Add to Watchlist" stores what the feed would.
 */

import { NextRequest, NextResponse } from "next/server";
import { logAuthFailure } from "@/lib/auth-guard";
import { createClient } from "@/lib/supabase/server";
import { loadSharedTitle } from "@/app/t/[key]/data";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  // getClaims verifies the session token locally (no round trip to Supabase
  // Auth, unlike getUser): about 0.5s less per search, measured 2026-11-04.
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) {
    logAuthFailure("/api/search/title");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const key = req.nextUrl.searchParams.get("key") ?? "";
  try {
    const shared = await loadSharedTitle(key);
    if (!shared) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(shared);
  } catch (e) {
    console.error("[search/title] lookup failed", e);
    return NextResponse.json({ error: "Unavailable" }, { status: 502 });
  }
}
