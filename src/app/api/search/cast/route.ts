/**
 * GET /api/search/cast?keys=movie-1900,tv-5321 — the lead actors under each
 * Search result, fetched after the list shows so the list never waits on it.
 *   → { cast: { "movie-1900": "Michael Douglas, Benicio del Toro", … } }
 */

import { NextRequest, NextResponse } from "next/server";
import { logAuthFailure } from "@/lib/auth-guard";
import { createClient } from "@/lib/supabase/server";
import { leadCast } from "@/lib/tmdb";

// The list shows six; a little headroom, and no more (one TMDB call each).
const MAX_KEYS = 8;

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  // getClaims: a local token check, as in ../route.ts.
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) {
    logAuthFailure("/api/search/cast");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const titles = (req.nextUrl.searchParams.get("keys") ?? "")
    .split(",")
    .slice(0, MAX_KEYS)
    .map((k) => /^(movie|tv)-(\d{1,10})$/.exec(k.trim()))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ type: m[1] as "movie" | "tv", tmdb_id: m[2] }));

  return NextResponse.json({ cast: titles.length ? await leadCast(titles) : {} });
}
