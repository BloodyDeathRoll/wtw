/**
 * GET /api/search/person?id=525 — a person's page in Search (2026-11-05): a
 * director's films or an actor's titles, newest first.
 *   → { person: PersonPage }
 */

import { NextRequest, NextResponse } from "next/server";
import { logAuthFailure } from "@/lib/auth-guard";
import { createClient } from "@/lib/supabase/server";
import { personTitles } from "@/lib/tmdb";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  // getClaims: a local token check, as in ../route.ts.
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) {
    logAuthFailure("/api/search/person");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!/^\d{1,10}$/.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const person = await personTitles(id);
    if (!person) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ person });
  } catch (e) {
    console.error("[search/person] TMDB failed", e);
    return NextResponse.json({ error: "Unavailable" }, { status: 502 });
  }
}
