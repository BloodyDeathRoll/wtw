/**
 * POST /api/recommendations/stopped — v3 F4 (docs/plan/v3/FOR-YOU.md DEC-6, issue #351).
 *
 * The phone reports For you cards the person stopped on (at least half on screen for at least a second), a few at a
 * time:  body { keys: ["movie:603", …] }. Each is marked on served_titles (`mark_stopped_on`, migration 0035); the next
 * Refresh counts the ones left alone as skipped, and they rest (src/lib/resting.ts).
 *
 * Only keys in this person's own 20s are marked, so a report can't touch anything else. Only with FOR_YOU_V3 on (404
 * otherwise). Nothing the person sees waits on it: the phone fires it and moves on.
 */

import { NextResponse } from "next/server";
import { logAuthFailure } from "@/lib/auth-guard";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth-user";
import { createServiceClient } from "@/lib/supabase/service";
import { forYouV3Enabled } from "@/lib/flags";
import { titleKey } from "@/lib/title-key";

/** More than two sets' worth in one report is not a phone's. */
const MAX_KEYS = 40;
const KEY = /^(movie|tv):\d+$/;

export async function POST(req: Request) {
  if (!forYouV3Enabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const supabase = await createClient();
  const user = await getAuthUser(supabase);
  if (!user) {
    logAuthFailure("/api/recommendations/stopped");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const asked: string[] = Array.isArray(body?.keys)
    ? [...new Set((body.keys as unknown[]).filter((k): k is string => typeof k === "string" && KEY.test(k)))]
    : [];
  if (asked.length === 0 || asked.length > MAX_KEYS) {
    return NextResponse.json({ error: `keys: 1 to ${MAX_KEYS} "type:tmdb_id" strings` }, { status: 400 });
  }

  const db = createServiceClient();
  const { data: sets, error: setsError } = await db.from("for_you_sets").select("recs").eq("user_id", user.id);
  if (setsError) {
    console.warn("[recommendations/stopped] the 20s unread:", setsError.message);
    return NextResponse.json({ error: "Try again" }, { status: 503 });
  }
  const inSets = new Set<string>();
  for (const row of (sets ?? []) as { recs: { tmdb_id: string; type: "movie" | "tv" }[] | null }[]) {
    for (const r of row.recs ?? []) inSets.add(titleKey(r.type, r.tmdb_id));
  }
  const keys = asked.filter((k) => inSets.has(k));
  if (keys.length === 0) return NextResponse.json({ marked: 0 });

  const { error } = await db.rpc("mark_stopped_on", { p_user_id: user.id, p_keys: keys });
  if (error) {
    console.warn("[recommendations/stopped] mark_stopped_on failed:", error.message);
    return NextResponse.json({ error: "Try again" }, { status: 503 });
  }
  return NextResponse.json({ marked: keys.length });
}
