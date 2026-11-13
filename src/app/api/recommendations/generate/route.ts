// GET  — serves paginated recommendations to the UI.
//        Checks Redis cache (keyed by taste_version) first; otherwise runs the
//        engine on the spot (a brand-new user gets a blank DNA here and the
//        cold-start batch of popular titles — never placeholder cards).
// POST — runs the full Assignment 2 engine pipeline and returns RecommendationResult[]

import { NextRequest, NextResponse } from "next/server";
import { logAuthFailure } from "@/lib/auth-guard";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth-user";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";
import { generateRecommendations } from "@/modules/engine";
import { createBlankDNA } from "@/modules/dna/blank-dna";
import { getCachedRecommendations } from "@/modules/engine/pipeline/step8-cache";
import { buildRecPage, getRemovedKeys } from "@/lib/rec-page";
import { startTimer } from "@/lib/timing";
import { isContentType, type ContentType } from "@/lib/content-type";
import type { SessionContext, DNASchema, RecommendationResult } from "@/types/dna";

export const runtime = "nodejs";

// ── GET: paginated list for the RecommendationsView UI ────────
export async function GET(req: Request) {
  const supabase = await createClient();
  const user = await getAuthUser(supabase);
  if (!user) {
    logAuthFailure("/api/recommendations/generate");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // servePage below is a hoisted function declaration, so it can't see this
  // null check on `user`; hand it the id instead.
  const userId = user.id;

  const url = new URL(req.url);
  const offsetParam = url.searchParams.get("offset");
  const offset = Number.isFinite(Number(offsetParam))
    ? Math.max(0, Number(offsetParam))
    : 0;
  // The taste_version the client's offset belongs to. The live batch is
  // replaced under a scrolling user (refresh-batch.ts, every 5 ratings), and an
  // offset carried into the replacement skipped its top — a user at offset 42
  // was handed positions 42–49 of a batch whose 42 best matches they never saw
  // (seen live 2026-11-05). When the version moved, the walk restarts at 0; the
  // client dedups what is already on screen.
  //
  // The version stands in for a batch id because every bump comes with a new
  // batch: a card rating does not bump it (merge-feedback-signal.ts, light
  // merge), the refresh bumps it as it promotes a batch, session/end bumps it
  // as it regenerates, and a bump with nothing cached under it (a rule edit)
  // lands in the cold path below, which regenerates. An unparseable `v` is a
  // mismatch and restarts too.
  const versionParam = url.searchParams.get("v");
  // Movies/Series. A GENERATION input now (2026-08-29): the batch is built
  // for this type and cached under it, so a series batch is 50 series. It
  // used to be a read-time filter over a type-blind batch, which left ~1
  // servable series per batch for a movie-dominant fingerprint.
  const contentTypeParam = url.searchParams.get("type");
  const contentType: ContentType = isContentType(contentTypeParam) ? contentTypeParam : "all";

  let cachedRecs: RecommendationResult[] | null = null
  let dna: DNASchema | null = null
  // Distinguishes "read the DNA and the user genuinely has none" (→ create
  // the blank one and generate) from "couldn't read the DNA at all" (→ fail
  // closed with a retryable error rather than guess).
  let dnaReadFailed = false

  // ── Read the fingerprint and the removed list together (independent reads,
  //    one round trip). The DNA read keeps its own try: a DB failure here is
  //    different from a Redis failure below. ──────────────────────────────
  // Step times for a card page (2026-11-13: ~1.6 s per page, cause not yet known).
  const t = startTimer("recs/get");
  const dnaRead = createServiceClient()
    .from("users")
    .select("dna")
    .eq("id", user.id)
    .single<{ dna: DNASchema | null }>()
    .then((r) => ({ ok: true as const, ...r }), (err: unknown) => ({ ok: false as const, err }));
  // Titles the user has "Removed" — filtered out of every page below.
  const [removed, dnaResult] = await Promise.all([getRemovedKeys(user.id), dnaRead]);
  t.mark("dna + removed list");

  try {
    if (!dnaResult.ok) throw dnaResult.err;
    const { data, error } = dnaResult;

    if (error && error.code !== "PGRST116") {
      // PGRST116 = no row = determinate "not onboarded" (fine → blank DNA
      // below). Any other error means we couldn't determine fingerprint
      // status → fail closed below rather than guess.
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
  //    so the cold path below regenerates) ──────────────────────────────────
  if (dna) {
    try {
      cachedRecs = await getCachedRecommendations(user.id, dna.metadata.taste_version, contentType)
      t.mark("batch cache read")
    } catch (err) {
      console.error(
        "[recommendations/generate] cache read failed:",
        err instanceof Error ? err.message : err,
      )
    }
  }

  // The page itself is built in src/lib/rec-page.ts, shared with session/end.
  async function servePage(recs: RecommendationResult[], source: string) {
    const taste_version = dna?.metadata.taste_version ?? null;
    const start = versionParam != null && String(taste_version) !== versionParam ? 0 : offset;
    return NextResponse.json(await buildRecPage({ userId, dna, recs, removed, start, contentType, source }));
  }

  if (cachedRecs && cachedRecs.length > 0) {
    return servePage(cachedRecs, "cache");
  }

  // Couldn't read the DNA (DB outage) — fingerprint status is unknown, so fail
  // closed with a retryable error instead of guessing.
  if (dnaReadFailed) {
    return NextResponse.json(
      { error: "Couldn't load recommendations right now", recommendations: [], next_offset: offset, has_more: false },
      { status: 503 },
    );
  }

  // No fingerprint row yet: the very first visit, before the app shell's
  // warm-up (POST /api/dna/bootstrap) has landed. Create the blank DNA here,
  // the same way bootstrap does, so this request can generate instead of
  // showing placeholders (removed 2026-10-21 — real users saw mock cards
  // with invented art). Both writers only write when the row is still null;
  // if the warm-up won the race, generate from what it wrote, not from this
  // request's copy. The users row itself always exists by now: migration
  // 0001's on_auth_user_created trigger inserts it at signup.
  if (!dna) {
    const db = createServiceClient();
    const blank = createBlankDNA(userId);
    const { data: written, error: writeError } = await db
      .from("users")
      .update({ dna: blank, updated_at: new Date().toISOString() })
      .eq("id", userId)
      .is("dna", null)
      .select("dna");
    if (writeError) {
      console.error("[recommendations/generate] blank DNA write failed:", writeError.message);
      return NextResponse.json(
        { error: "Couldn't load recommendations right now", recommendations: [], next_offset: offset, has_more: false },
        { status: 503 },
      );
    }
    if (written && written.length > 0) {
      dna = blank;
    } else {
      const { data: row, error: rereadError } = await db
        .from("users")
        .select("dna")
        .eq("id", userId)
        .single<{ dna: DNASchema | null }>();
      if (rereadError || !row?.dna) {
        console.error("[recommendations/generate] DNA re-read after lost race failed:", rereadError?.message ?? "no dna");
        return NextResponse.json(
          { error: "Couldn't load recommendations right now", recommendations: [], next_offset: offset, has_more: false },
          { status: 503 },
        );
      }
      dna = row.dna;
    }
  }

  // Cold cache: regenerate on demand. Until the fingerprint is ready (season
  // finished or 10 ratings — cold-start.ts fingerprintReady) this is the cold-start
  // batch (popular crowd-pleasers, src/modules/engine/pipeline/cold-start.ts),
  // which needs no embedding, so a blank fingerprint generates fine.
  // generateRecommendations writes the Redis cache, so subsequent paginated
  // GETs hit the warm path above; here we serve the fresh list directly.
  try {
    await generateRecommendations(userId, undefined, { dna, contentType });
    const fresh = await getCachedRecommendations(userId, dna.metadata.taste_version, contentType);
    if (fresh && fresh.length > 0) {
      return servePage(fresh, "regenerated");
    }
    // Regen legitimately produced nothing (e.g. every candidate is watched or
    // removed). Return an empty page.
    return NextResponse.json({
      recommendations: [],
      next_offset: offset,
      has_more: false,
      source: "regenerated_empty",
    });
  } catch (err) {
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

// Each POST can spend a Mistral call on the shared free-tier key, and a
// session_override_active body skips the cache (dream review 2026-09-30); the
// window is generous for a real user.
const RATE_LIMIT = { scope: "recommendations-generate", perUser: 20, windowSec: 10 * 60 };

// ── POST: full engine pipeline (Assignment 2) ─────────────────
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const user = await getAuthUser(supabase);

  if (!user) {
    logAuthFailure("/api/recommendations/generate");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const limited = await enforceRateLimit(req, user.id, RATE_LIMIT);
  if (limited) return limited;

  let session_context: SessionContext | undefined;
  // Which list to warm. Batches are cached per content type, so a warm-up
  // without one would fill rec:{user}:{version}:all — a key nothing serving
  // cards reads any more, leaving the first tap a cold miss regardless.
  let warmType: ContentType = "all";
  try {
    const body = await req.json().catch(() => ({}));
    if (body.session_context) {
      session_context = body.session_context as SessionContext;
    }
    if (isContentType(body.content_type)) warmType = body.content_type;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const results = await generateRecommendations(user.id, session_context, { contentType: warmType });
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
