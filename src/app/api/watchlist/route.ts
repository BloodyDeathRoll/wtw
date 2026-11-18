/**
 * /api/watchlist
 *
 * The user's saved cards, so the watchlist follows the login across devices.
 * localStorage (src/lib/watchlist.ts) is the client's cache of this table.
 *
 *   GET  — the list, newest first
 *   POST — apply queued changes, then return the list
 *          body: { upsert?: WireEntry[], delete?: string[] }
 *          → { entries, rejected: string[] }  (ids of changes skipped as malformed)
 *
 * The fingerprint's "saved" marker is separate and still rides on
 * /api/session/end. All operations are scoped to the authenticated user via RLS.
 *
 * Where to watch, Israel (docs/plan/v3/WATCHLIST.md DEC-11): the Watchlist's
 * rows name the Israeli service, which the saved card doesn't carry (it was
 * served with the US one). Every read fills `rec.where_il` for a few entries
 * that still lack it, straight from TMDB, and stores it on the entry, so each
 * title is asked about once (IL_FILL_PER_READ a read; the next read takes the
 * next few). New saves come with it once the engine has checked IL
 * (ensureWatchProviders stores US and IL since 2026-11-18).
 */

import { NextRequest, NextResponse } from "next/server";
import { logAuthFailure } from "@/lib/auth-guard";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth-user";
import { getWatchProviders } from "@/lib/tmdb";
import { pickIsraelProvider } from "@/lib/watch-providers";
import { MAX_ENTRIES, isId, isStarredColumnError, saveRows, toRow, type WatchlistRow } from "./store";

/** TMDB calls one read may spend on Israeli availability (free tier: 40 per 10 s). */
const IL_FILL_PER_READ = 10;

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

interface Row {
  rec_id: string;
  rec: Record<string, unknown>;
  explain: Record<string, unknown> | null;
  rating: string | null;
  starred: boolean | null;
  added_at: string;
}

/**
 * Until migration 0034 is applied the table has no `starred` column; a deploy
 * that lands before it must not take the list down. Once a query says the
 * column is missing, reads and writes leave it out (stars then live on the
 * device only) until the process restarts.
 */
let starredColumnMissing = false;

async function readList(supabase: SupabaseClient, userId: string) {
  const select = (withStarred: boolean) =>
    supabase
      .from("watchlist_entries")
      .select(withStarred ? "rec_id, rec, explain, rating, starred, added_at" : "rec_id, rec, explain, rating, added_at")
      .eq("user_id", userId)
      .order("added_at", { ascending: false })
      .limit(MAX_ENTRIES);
  let { data, error } = await select(!starredColumnMissing);
  if (error && !starredColumnMissing && isStarredColumnError(error)) {
    console.warn("[watchlist] no `starred` column yet (migration 0034): reading without it");
    starredColumnMissing = true;
    ({ data, error } = await select(false));
  }
  if (error) return { error };
  // Two select strings: the typed parser cannot read both, so the rows are cast.
  const rows = (data ?? []) as unknown as Row[];
  await fillIsrael(supabase, userId, rows);
  return {
    entries: rows.map((r) => ({
      rec: r.rec,
      explain: r.explain,
      rating: r.rating,
      starred: r.starred === true,
      added_at: new Date(r.added_at).getTime(),
    })),
  };
}

/**
 * Fill `rec.where_il` on up to IL_FILL_PER_READ rows that don't have it yet
 * (the key is absent; null means "asked, on none of the four"). Best-effort:
 * a TMDB or DB failure leaves the row for the next read. Mutates `rows` so
 * the response carries the answer at once.
 */
async function fillIsrael(supabase: SupabaseClient, userId: string, rows: Row[]) {
  const todo = rows
    .filter((r) => !("where_il" in r.rec) && /^(movie|tv):\d+$/.test(r.rec_id))
    .slice(0, IL_FILL_PER_READ);
  if (todo.length === 0) return;
  await Promise.all(
    todo.map(async (r) => {
      try {
        const [type, tmdbId] = r.rec_id.split(":") as ["movie" | "tv", string];
        const providers = await getWatchProviders(type, tmdbId, ["IL"]);
        // A 404 (null) still counts as asked: re-asking buys nothing.
        const rec = { ...r.rec, where_il: pickIsraelProvider(providers?.IL) };
        const { error } = await supabase
          .from("watchlist_entries")
          .update({ rec })
          .eq("user_id", userId)
          .eq("rec_id", r.rec_id);
        if (error) throw new Error(error.message);
        r.rec = rec;
      } catch (e) {
        console.warn("[watchlist] IL fill failed (left for next read):", r.rec_id, e instanceof Error ? e.message : e);
      }
    }),
  );
}

async function authed() {
  const supabase = await createClient();
  const user = await getAuthUser(supabase);
  return { supabase, user };
}

function withoutStarred(row: WatchlistRow): Omit<WatchlistRow, "starred"> {
  const { starred: _starred, ...rest } = row;
  return rest;
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

  const body = (await req.json().catch(() => null)) ?? {};
  const upsertIn: unknown[] = Array.isArray(body.upsert) ? body.upsert : [];
  const deleteIn: unknown[] = Array.isArray(body.delete) ? body.delete : [];
  if (upsertIn.length > MAX_ENTRIES || deleteIn.length > MAX_ENTRIES) {
    return NextResponse.json({ error: "too many changes" }, { status: 400 });
  }

  // Malformed changes are skipped and named back, not allowed to fail the
  // batch: the client drops what it's told was rejected and keeps the rest.
  const rejected: string[] = [];
  const rows: WatchlistRow[] = [];
  for (const e of upsertIn) {
    const row = toRow(user.id, e);
    if (row) rows.push(row);
    else {
      const id = (e as { rec?: { id?: unknown } } | null)?.rec?.id;
      if (typeof id === "string") rejected.push(id);
    }
  }
  const deletes = deleteIn.filter(isId);

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

  let saveError = await saveRows(supabase, user.id, starredColumnMissing ? rows.map(withoutStarred) : rows);
  if (saveError && !starredColumnMissing && isStarredColumnError(saveError)) {
    console.warn("[watchlist] no `starred` column yet (migration 0034): saving without it");
    starredColumnMissing = true;
    saveError = await saveRows(supabase, user.id, rows.map(withoutStarred));
  }
  if (saveError) {
    console.error("[watchlist] upsert failed", saveError.message);
    return NextResponse.json({ error: "Failed to update watchlist" }, { status: 500 });
  }

  const { entries, error } = await readList(supabase, user.id);
  if (error) {
    console.error("[watchlist] list failed", error.message);
    return NextResponse.json({ error: "Failed to load watchlist" }, { status: 500 });
  }
  return NextResponse.json({ entries, rejected });
}
