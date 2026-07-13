/**
 * /api/recommendations/removed
 *
 * The user's suppression list — titles they explicitly "Removed" from
 * recommendations. Removed titles are filtered out of the served feed
 * (see GET /api/recommendations/generate) so they're never shown again.
 *
 *   POST   — add a title to the removed list   body: { tmdb_id, media_type, title? }
 *   GET    — list the user's removed titles     (for the future "Removed" screen)
 *   DELETE — restore a title                     body: { tmdb_id, media_type }
 *
 * All operations are scoped to the authenticated user via RLS.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type MediaType = "movie" | "tv";

function isMediaType(v: unknown): v is MediaType {
  return v === "movie" || v === "tv";
}

// ── POST: remove a title ──────────────────────────────────────
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const tmdb_id = typeof body.tmdb_id === "string" ? body.tmdb_id : null;
  const media_type = isMediaType(body.media_type) ? body.media_type : null;
  const title = typeof body.title === "string" ? body.title : null;

  if (!tmdb_id || !media_type) {
    return NextResponse.json(
      { error: "tmdb_id and media_type ('movie'|'tv') are required" },
      { status: 400 },
    );
  }

  // Upsert so re-removing the same title is a harmless no-op. ignoreDuplicates
  // makes the conflict path DO NOTHING (not DO UPDATE): re-removal needs no
  // change, and DO UPDATE would require an UPDATE RLS policy this table
  // deliberately doesn't grant (see 0010_removed_titles.sql).
  const { error } = await supabase
    .from("removed_titles")
    .upsert(
      { user_id: user.id, tmdb_id, media_type, title },
      { onConflict: "user_id,tmdb_id,media_type", ignoreDuplicates: true },
    );

  if (error) {
    console.error("[recommendations/removed] insert failed", error.message);
    return NextResponse.json({ error: "Failed to remove title" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

// ── GET: list removed titles (newest first) ───────────────────
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("removed_titles")
    .select("tmdb_id, media_type, title, removed_at")
    .eq("user_id", user.id)
    .order("removed_at", { ascending: false });

  if (error) {
    console.error("[recommendations/removed] list failed", error.message);
    return NextResponse.json({ error: "Failed to load removed titles" }, { status: 500 });
  }

  return NextResponse.json({ removed: data ?? [] });
}

// ── DELETE: restore a title ───────────────────────────────────
export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const tmdb_id = typeof body.tmdb_id === "string" ? body.tmdb_id : null;
  const media_type = isMediaType(body.media_type) ? body.media_type : null;

  if (!tmdb_id || !media_type) {
    return NextResponse.json(
      { error: "tmdb_id and media_type ('movie'|'tv') are required" },
      { status: 400 },
    );
  }

  const { error } = await supabase
    .from("removed_titles")
    .delete()
    .eq("user_id", user.id)
    .eq("tmdb_id", tmdb_id)
    .eq("media_type", media_type);

  if (error) {
    console.error("[recommendations/removed] delete failed", error.message);
    return NextResponse.json({ error: "Failed to restore title" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
