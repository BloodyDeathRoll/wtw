// GET  — serves paginated recommendations to the UI (mock data until engine is seeded)
// POST — runs the full Assignment 2 engine pipeline and returns RecommendationResult[]

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  MOCK_RECOMMENDATIONS,
  pageOf,
} from "@/modules/session/recommendations/mock-data";
import { generateRecommendations } from "@/modules/engine";
import type { SessionContext } from "@/types/dna";

export const runtime = "nodejs";

const DEFAULT_PAGE_SIZE = 6;

// ── GET: paginated list for the RecommendationsView UI ────────
export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const offsetParam = url.searchParams.get("offset");
  const offset = Number.isFinite(Number(offsetParam))
    ? Math.max(0, Number(offsetParam))
    : 0;
  const contentType = url.searchParams.get("type"); // "movies" | "series"

  // Only the two known values filter. Anything else (a typo like "movie", an
  // unknown future caller, a different case) returns the full mixed list rather
  // than silently collapsing to a tv-only slice.
  const filtered =
    contentType === "movies"
      ? MOCK_RECOMMENDATIONS.filter((r) => r.type === "movie")
      : contentType === "series"
        ? MOCK_RECOMMENDATIONS.filter((r) => r.type === "tv")
        : MOCK_RECOMMENDATIONS;

  const { items, nextOffset, hasMore } = pageOf(
    filtered,
    offset,
    DEFAULT_PAGE_SIZE,
  );

  return NextResponse.json({
    recommendations: items,
    next_offset: nextOffset,
    has_more: hasMore,
  });
}

// ── POST: full engine pipeline (Assignment 2) ─────────────────
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let session_context: SessionContext | undefined;
  try {
    const body = await req.json().catch(() => ({}));
    if (body.session_context) {
      session_context = body.session_context as SessionContext;
    }
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const results = await generateRecommendations(user.id, session_context);
    return NextResponse.json(results);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[recommendations/generate]", message);

    if (message.includes("No DNA found")) {
      return NextResponse.json(
        { error: "Profile not set up yet. Complete onboarding first." },
        { status: 404 },
      );
    }

    return NextResponse.json(
      { error: "Failed to generate recommendations" },
      { status: 500 },
    );
  }
}
