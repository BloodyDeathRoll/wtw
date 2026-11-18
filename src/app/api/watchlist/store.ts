/**
 * The watchlist's own rules for a save, in one place: what a valid entry is,
 * and how rows are written. /api/watchlist uses them for the app's saves, and
 * the consultant chat for a title the person asked it to add (P3-6), so a chat
 * save is stored exactly as any other.
 */

import type { createClient } from "@/lib/supabase/server";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

// Mirrors the client's MAX_ENTRIES — the list a device can hold.
export const MAX_ENTRIES = 200;
// A card plus its Why breakdown is ~1–3KB; this only stops abuse.
const MAX_JSON_BYTES = 32_000;
const MAX_ID_LENGTH = 64;
const RATINGS = new Set(["loved", "liked", "disliked", "removed"]);

export function isId(v: unknown): v is string {
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
export function toRow(userId: string, e: unknown) {
  if (typeof e !== "object" || e === null) return null;
  const { rec, explain, rating, added_at, starred } = e as Record<string, unknown>;
  if (!isSmallObject(rec) || !isId(rec.id)) return null;
  if (explain != null && !isSmallObject(explain)) return null;
  if (rating != null && !(typeof rating === "string" && RATINGS.has(rating))) return null;
  // A star (DEC-4, migration 0034). Entries from before it carry none: not starred.
  if (starred != null && typeof starred !== "boolean") return null;
  const added =
    typeof added_at === "number" && Number.isFinite(added_at) ? new Date(added_at) : new Date();
  if (Number.isNaN(added.getTime())) return null;
  return {
    user_id: userId,
    rec_id: rec.id,
    rec,
    explain: explain ?? null,
    rating: (rating as string | null) ?? null,
    starred: starred === true,
    added_at: added.toISOString(),
    updated_at: new Date().toISOString(),
  };
}

export type WatchlistRow = NonNullable<ReturnType<typeof toRow>>;

/** PostgREST's word for a column the table doesn't have (yet): migration 0034's `starred`. */
export function isStarredColumnError(error: { message?: string } | null | undefined): boolean {
  return /starred/i.test(error?.message ?? "") && /column|schema cache/i.test(error?.message ?? "");
}

/** Write the rows (a save of a title already there replaces it). Returns the error, or null. */
export async function saveRows(
  supabase: SupabaseClient,
  userId: string,
  rows: (WatchlistRow | Omit<WatchlistRow, "starred">)[],
): Promise<{ message: string } | null> {
  if (rows.length === 0) return null;
  const { error } = await supabase
    .from("watchlist_entries")
    .upsert(rows, { onConflict: "user_id,rec_id" });
  if (error) return error;

  // Same cap as the client: drop the oldest past MAX_ENTRIES so the table
  // can't grow without bound. Best-effort — the read below is capped anyway.
  const { data: overflow } = await supabase
    .from("watchlist_entries")
    .select("rec_id")
    .eq("user_id", userId)
    .order("added_at", { ascending: false })
    .range(MAX_ENTRIES, MAX_ENTRIES * 2);
  if (overflow && overflow.length > 0) {
    await supabase
      .from("watchlist_entries")
      .delete()
      .eq("user_id", userId)
      .in(
        "rec_id",
        overflow.map((r) => r.rec_id as string),
      );
  }
  return null;
}
