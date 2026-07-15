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
import { tmdbPosterUrl, youtubeTrailerUrl } from "@/lib/tmdb";
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
 * The user's suppression list as a Set of `${media_type}:${tmdb_id}` keys —
 * the same shape as a Recommendation.id and `${result.type}:${tmdb_id}`.
 * Removed titles are filtered out of every served page so a title the user
 * "Removed" is never shown again, even if it's still in the Redis cache.
 */
async function getRemovedKeys(userId: string): Promise<Set<string>> {
  try {
    const db = createServiceClient();
    const { data } = await db
      .from("removed_titles")
      .select("tmdb_id, media_type")
      .eq("user_id", userId);
    return new Set((data ?? []).map((r) => `${r.media_type}:${r.tmdb_id}`));
  } catch (err) {
    console.error(
      "[recommendations/generate] removed-list read failed:",
      err instanceof Error ? err.message : err,
    );
    return new Set();
  }
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
    .select("tmdb_id, type, poster_path, trailer_key, release_year, runtime_minutes, tmdb_rating")
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
      trailer_url: youtubeTrailerUrl(t?.trailer_key as string | null | undefined),
      meta,
      rating: (t?.tmdb_rating as number | null) ?? 0,
      match: Math.max(0, Math.min(1, r.composite_score)),
      reason: r.explanation || "Matched to your fingerprint",
      where: null,
      is_stretch_pick: r.is_stretch_pick,
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

  // Titles the user has "Removed" — filtered out of every page below.
  const removed = await getRemovedKeys(user.id);

  let cachedRecs: RecommendationResult[] | null = null
  let dna: DNASchema | null = null
  // Distinguishes "read the DNA and the user genuinely has none" (→ mocks are
  // the correct pre-first-session placeholder) from "couldn't read the DNA at
  // all" (→ fingerprint status unknown, so we must NOT risk serving mocks).
  let dnaReadFailed = false

  // ── Read the fingerprint (its own try: a DB failure here is different from a
  //    Redis failure below) ─────────────────────────────────────────────────
  try {
    const db = createServiceClient()
    const { data, error } = await db
      .from("users")
      .select("dna")
      .eq("id", user.id)
      .single<{ dna: DNASchema | null }>()

    if (error && error.code !== "PGRST116") {
      // PGRST116 = no row = determinate "not onboarded" (fine → mocks). Any
      // other error means we couldn't determine fingerprint status → fail
      // closed below rather than guess.
      dnaReadFailed = true
      console.error("[recommendations/generate] DNA read failed:", error.message)
    } else {
      dna = data?.dna ?? null
    }
  } catch (err) {
    dnaReadFailed = true
    console.error(
      "[recommendations/generate] DNA read threw:",
      err instanceof Error ? err.message : err,
    )
  }

  // ── Read the rec cache (a Redis blip here is non-fatal: dna is already known,
  //    so the cold path below still routes a fingerprinted user to regen, never
  //    to mocks) ───────────────────────────────────────────────────────────
  if (dna) {
    try {
      cachedRecs = await getCachedRecommendations(user.id, dna.metadata.taste_version)
    } catch (err) {
      console.error(
        "[recommendations/generate] cache read failed:",
        err instanceof Error ? err.message : err,
      )
    }
  }

  // Type-filter → drop removed titles → paginate → adapt to the UI shape. Used
  // for both the warm cache and a freshly regenerated list so their handling
  // can't drift apart.
  async function servePage(recs: RecommendationResult[], source: string) {
    const typeFiltered =
      contentType === "movies"
        ? recs.filter((r) => r.type === "movie")
        : contentType === "series"
          ? recs.filter((r) => r.type === "tv")
          : recs;
    // Drop removed titles before paginating so pages stay full-sized.
    const filtered = typeFiltered.filter(
      (r) => !removed.has(`${r.type}:${r.tmdb_id}`),
    );
    const items = filtered.slice(offset, offset + DEFAULT_PAGE_SIZE);
    const nextOffset = offset + items.length;
    const hasMore = nextOffset < filtered.length;
    const uiRecs = await toUIRecommendations(items);
    return NextResponse.json({ recommendations: uiRecs, next_offset: nextOffset, has_more: hasMore, source });
  }

  if (cachedRecs && cachedRecs.length > 0) {
    return servePage(cachedRecs, "cache");
  }

  // Couldn't read the DNA (DB outage) — fingerprint status is unknown, so fail
  // closed: a fingerprinted user must NEVER see mocks, and we can't rule that
  // out here. Return a retryable error instead of guessing.
  if (dnaReadFailed) {
    return NextResponse.json(
      { error: "Couldn't load recommendations right now", recommendations: [], next_offset: offset, has_more: false },
      { status: 503 },
    );
  }

  // Cold cache. Mocks are a PRE-FIRST-SESSION placeholder only — a user who
  // already has a fingerprint must never see them. A blank DNA carries
  // taste_version 1 but total_sessions 0, so key off sessions/signals, not
  // version. When fingerprinted, regenerate on demand: generateRecommendations
  // writes the Redis cache, so subsequent paginated GETs hit the warm path
  // above; here we serve the fresh list directly.
  const hasFingerprint =
    !!dna && (dna.metadata.total_sessions > 0 || dna.signals.length > 0);

  if (hasFingerprint) {
    try {
      await generateRecommendations(user.id);
      const fresh = await getCachedRecommendations(user.id, dna!.metadata.taste_version);
      if (fresh && fresh.length > 0) {
        return servePage(fresh, "regenerated");
      }
      // Regen legitimately produced nothing (e.g. every candidate is watched or
      // removed). Return an empty page — NOT mocks.
      return NextResponse.json({
        recommendations: [],
        next_offset: offset,
        has_more: false,
        source: "regenerated_empty",
      });
    } catch (err) {
      // A fingerprinted user must never see mocks — surface a retryable error
      // instead of fabricated titles.
      console.error(
        "[recommendations/generate] cold regen failed:",
        err instanceof Error ? err.message : err,
      );
      return NextResponse.json(
        { error: "Couldn't load recommendations right now", recommendations: [], next_offset: offset, has_more: false },
        { status: 503 },
      );
    }
  }

  // Genuinely no fingerprint yet (pre-first-session) — mocks are the intended
  // placeholder here, and ONLY here.
  const mockTypeFiltered =
    contentType === "movies"
      ? MOCK_RECOMMENDATIONS.filter((r) => r.type === "movie")
      : contentType === "series"
        ? MOCK_RECOMMENDATIONS.filter((r) => r.type === "tv")
        : MOCK_RECOMMENDATIONS;
  // `removed` is keyed `${media_type}:${tmdb_id}`. Mock ids are bare slugs with
  // no `type:` prefix (unlike engine rec ids), and handleRemove persists them as
  // tmdb_id = the bare id, so reconstruct the same key here — using r.id
  // directly would never match and the removed mock would reappear.
  const mockFiltered = mockTypeFiltered.filter(
    (r) => !removed.has(`${r.type}:${r.id}`),
  );

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
