// GET  — serves paginated recommendations to the UI.
//        Checks Redis cache (keyed by taste_version) first; falls back to mocks
//        when the DB is not yet seeded or no recs have been generated.
// POST — runs the full Assignment 2 engine pipeline and returns RecommendationResult[]

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  MOCK_RECOMMENDATIONS,
  pageOf,
} from "@/modules/session/recommendations/mock-data";
import { generateRecommendations } from "@/modules/engine";
import { getCachedRecommendations } from "@/modules/engine/pipeline/step8-cache";
import { tmdbPosterUrl } from "@/lib/tmdb";
import type { SessionContext, DNASchema, RecommendationResult } from "@/types/dna";

export const runtime = "nodejs";

const DEFAULT_PAGE_SIZE = 6;

/**
 * Attach the `poster_url` enrichment field to engine recs by joining
 * `titles` on tmdb_id. RecommendationResult itself carries no poster
 * (it's not part of the shared contract) — the poster is looked up here.
 */
async function attachPosters(
  recs: RecommendationResult[],
): Promise<(RecommendationResult & { poster_url: string | null })[]> {
  if (recs.length === 0) return [];
  const db = createServiceClient();
  const { data } = await db
    .from("titles")
    .select("tmdb_id, poster_path")
    .in("tmdb_id", recs.map((r) => r.tmdb_id));
  const byId = new Map<string, string | null>(
    (data ?? []).map((t) => [t.tmdb_id as string, t.poster_path as string | null]),
  );
  return recs.map((r) => ({ ...r, poster_url: tmdbPosterUrl(byId.get(r.tmdb_id)) }));
}

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

  // Try Redis cache — requires knowing the user's current taste_version
  let cachedRecs: RecommendationResult[] | null = null

  try {
    const db = createServiceClient()
    const { data } = await db
      .from("users")
      .select("dna")
      .eq("id", user.id)
      .single<{ dna: DNASchema | null }>()

    if (data?.dna) {
      cachedRecs = await getCachedRecommendations(user.id, data.dna.metadata.taste_version)
    }
  } catch {
    // Redis or DB unavailable — fall through to mocks
  }

  if (cachedRecs && cachedRecs.length > 0) {
    const filtered =
      contentType === "movies"
        ? cachedRecs.filter((r) => r.type === "movie")
        : contentType === "series"
          ? cachedRecs.filter((r) => r.type === "tv")
          : cachedRecs;
    const items = filtered.slice(offset, offset + DEFAULT_PAGE_SIZE);
    const nextOffset = offset + items.length;
    const hasMore = nextOffset < filtered.length;
    const withPosters = await attachPosters(items);
    return NextResponse.json({ recommendations: withPosters, next_offset: nextOffset, has_more: hasMore, source: "cache" });
  }

  // Fall back to mocks (DB not yet seeded)
  const mockFiltered =
    contentType === "movies"
      ? MOCK_RECOMMENDATIONS.filter((r) => r.type === "movie")
      : contentType === "series"
        ? MOCK_RECOMMENDATIONS.filter((r) => r.type === "tv")
        : MOCK_RECOMMENDATIONS;

  const { items, nextOffset, hasMore } = pageOf(mockFiltered, offset, DEFAULT_PAGE_SIZE);

  return NextResponse.json({
    recommendations: items,
    next_offset: nextOffset,
    has_more: hasMore,
    source: "mock",
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
