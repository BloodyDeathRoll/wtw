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
import type { Recommendation, MotifKind } from "@/types/recommendation";

export const runtime = "nodejs";

const DEFAULT_PAGE_SIZE = 6;

// Deterministic motif/palette fallback for titles without a poster —
// same visual language as the mock cards, keyed stably off tmdb_id.
const MOTIFS: MotifKind[] = ["spades", "circle", "star", "cross", "dot", "wave"];
const PALETTES: [string, string][] = [
  ["#1B2A28", "#C7B8FF"],
  ["#2A1B24", "#FFD9A0"],
  ["#1B2333", "#9AD1FF"],
  ["#241B2E", "#F2A0E8"],
  ["#1E2A1B", "#B8FFC7"],
  ["#2E241B", "#FFC79A"],
];
function hashId(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

/**
 * Adapt engine RecommendationResult → the UI's Recommendation shape
 * (src/types/recommendation.ts). The engine result is the shared contract and
 * carries no display fields; per that type's comment, THIS route adapts the
 * source to what the UI renders — id, year, meta, rating, match, reason,
 * poster_url (joined from `titles` on (tmdb_id, type)), motif/palette fallback.
 */
async function toUIRecommendations(
  recs: RecommendationResult[],
): Promise<Recommendation[]> {
  if (recs.length === 0) return [];
  const db = createServiceClient();
  const { data } = await db
    .from("titles")
    .select("tmdb_id, type, poster_path, release_year, runtime_minutes, tmdb_rating")
    .in("tmdb_id", recs.map((r) => r.tmdb_id));
  const byKey = new Map(
    (data ?? []).map((t) => [`${t.type}:${t.tmdb_id}`, t]),
  );

  return recs.map((r) => {
    const t = byKey.get(`${r.type}:${r.tmdb_id}`);
    const h = hashId(r.tmdb_id);
    const runtime = (t?.runtime_minutes as number | null) ?? null;
    const meta =
      r.type === "movie"
        ? runtime
          ? `${Math.floor(runtime / 60)}h ${runtime % 60}m`
          : "Film"
        : runtime
          ? `~${runtime}m episodes`
          : "Series";
    return {
      id: `${r.type}:${r.tmdb_id}`,          // stable — feedback + React keys
      title: r.title,
      type: r.type,
      year: (t?.release_year as number | null) ?? 0,
      poster_url: tmdbPosterUrl(t?.poster_path as string | null | undefined),
      meta,
      rating: (t?.tmdb_rating as number | null) ?? 0,
      match: Math.max(0, Math.min(1, r.composite_score)),
      reason: r.explanation || "Matched to your fingerprint",
      where: null,
      motif: MOTIFS[h % MOTIFS.length],
      palette: PALETTES[h % PALETTES.length],
    };
  });
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
    const uiRecs = await toUIRecommendations(items);
    return NextResponse.json({ recommendations: uiRecs, next_offset: nextOffset, has_more: hasMore, source: "cache" });
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
