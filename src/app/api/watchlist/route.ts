/**
 * /api/watchlist
 *
 * The user's saved cards, so the watchlist follows the login across devices.
 * localStorage (src/lib/watchlist.ts) is the client's cache of this table.
 *
 *   GET  — the list, newest first
 *   POST — apply queued changes, then return the list
 *          body: { upsert?: WireEntry[], delete?: string[] }
 *
 * The fingerprint's "saved" marker is separate and still rides on
 * /api/session/end. All operations are scoped to the authenticated user via RLS.
 */

import { NextRequest, NextResponse } from "next/server";
import { logAuthFailure } from "@/lib/auth-guard";
import { createClient } from "@/lib/supabase/server";

// Mirrors the client's MAX_ENTRIES — the list a device can hold.
const MAX_ENTRIES = 200;
// A card plus its Why breakdown is ~1–3KB; this only stops abuse.
const MAX_JSON_BYTES = 32_000;
const MAX_ID_LENGTH = 64;
const RATINGS = new Set(["loved", "liked", "disliked", "removed"]);

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

interface Row {
  rec_id: string;
  rec: Record<string, unknown>;
  explain: Record<string, unknown> | null;
  rating: string | null;
  added_at: string;
}

function isId(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= MAX_ID_LENGTH;
}

function isSmallObject(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    JSON.stringify(v).length <= MAX_JSON_BYTES
  );
}

/** A client entry → a row, or null when it's malformed. */
function toRow(userId: string, e: unknown) {
  if (typeof e !== "object" || e === null) return null;
  const { rec, explain, rating, added_at } = e as Record<string, unknown>;
  if (!isSmallObject(rec) || !isId(rec.id)) return null;
  if (explain != null && !isSmallObject(explain)) return null;
  if (rating != null && !(typeof rating === "string" && RATINGS.has(rating))) return null;
  const added =
    typeof added_at === "number" && Number.isFinite(added_at) ? new Date(added_at) : new Date();
  if (Number.isNaN(added.getTime())) return null;
  return {
    user_id: userId,
    rec_id: rec.id,
    rec,
    explain: explain ?? null,
    rating: (rating as string | null) ?? null,
    added_at: added.toISOString(),
    updated_at: new Date().toISOString(),
  };
}

async function readList(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("watchlist_entries")
    .select("rec_id, rec, explain, rating, added_at")
    .eq("user_id", userId)
    .order("added_at", { ascending: false })
    .limit(MAX_ENTRIES);
  if (error) return { error };
  return {
    entries: ((data ?? []) as Row[]).map((r) => ({
      rec: r.rec,
      explain: r.explain,
      rating: r.rating,
      added_at: new Date(r.added_at).getTime(),
    })),
  };
}

async function authed() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

// ── GET: the list ─────────────────────────────────────────────
export async function GET() {
  const { supabase, user } = await authed();
  if (!user) {
    logAuthFailure("/api/watchlist");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { entries, error } = await readList(supabase, user.id);
  if (error) {
    console.error("[watchlist] list failed", error.message);
    return NextResponse.json({ error: "Failed to load watchlist" }, { status: 500 });
  }
  return NextResponse.json({ entries });
}

// ── POST: apply changes, return the list ──────────────────────
export async function POST(req: NextRequest) {
  const { supabase, user } = await authed();
  if (!user) {
    logAuthFailure("/api/watchlist");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const upsertIn: unknown[] = Array.isArray(body.upsert) ? body.upsert : [];
  const deleteIn: unknown[] = Array.isArray(body.delete) ? body.delete : [];
  if (upsertIn.length > MAX_ENTRIES || deleteIn.length > MAX_ENTRIES) {
    return NextResponse.json({ error: "too many changes" }, { status: 400 });
  }

  const parsed = upsertIn.map((e) => toRow(user.id, e));
  const rows = parsed.filter((r): r is NonNullable<typeof r> => r !== null);
  if (rows.length !== parsed.length || !deleteIn.every(isId)) {
    return NextResponse.json({ error: "malformed watchlist change" }, { status: 400 });
  }
  const deletes = deleteIn as string[];

  if (deletes.length > 0) {
    const { error } = await supabase
      .from("watchlist_entries")
      .delete()
      .eq("user_id", user.id)
      .in("rec_id", deletes);
    if (error) {
      console.error("[watchlist] delete failed", error.message);
      return NextResponse.json({ error: "Failed to update watchlist" }, { status: 500 });
    }
  }

  if (rows.length > 0) {
    const { error } = await supabase
      .from("watchlist_entries")
      .upsert(rows, { onConflict: "user_id,rec_id" });
    if (error) {
      console.error("[watchlist] upsert failed", error.message);
      return NextResponse.json({ error: "Failed to update watchlist" }, { status: 500 });
    }

    // Same cap as the client: drop the oldest past MAX_ENTRIES so the table
    // can't grow without bound. Best-effort — the read below is capped anyway.
    const { data: overflow } = await supabase
      .from("watchlist_entries")
      .select("rec_id")
      .eq("user_id", user.id)
      .order("added_at", { ascending: false })
      .range(MAX_ENTRIES, MAX_ENTRIES * 2);
    if (overflow && overflow.length > 0) {
      await supabase
        .from("watchlist_entries")
        .delete()
        .eq("user_id", user.id)
        .in(
          "rec_id",
          overflow.map((r) => r.rec_id as string),
        );
    }
  }

  const { entries, error } = await readList(supabase, user.id);
  if (error) {
    console.error("[watchlist] list failed", error.message);
    return NextResponse.json({ error: "Failed to load watchlist" }, { status: 500 });
  }
  return NextResponse.json({ entries });
}
