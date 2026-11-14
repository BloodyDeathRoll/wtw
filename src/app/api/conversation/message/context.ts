/**
 * What the consultant chat may look at besides the fingerprint briefing: the
 * titles in the person's feed right now and the ones on their watchlist
 * (docs/plan/PLAN.md P3-2).
 *
 * Read-only, like everything under src/app/api/conversation/ (DEC-5;
 * tests/unit/chat-read-only.test.ts fails on a write here). Best-effort: a
 * failed read leaves that list out of the turn, it does not fail the chat.
 */

import { getCachedRecommendations } from "@/modules/engine/pipeline/step8-cache";
import { titleKey } from "@/lib/title-key";
import type { createClient } from "@/lib/supabase/server";
import type { DNASchema } from "@/types/dna";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

// Sent with every turn, so a short list: the top of the feed and the newest saves.
const FEED_TITLES = 20;
const WATCHLIST_TITLES = 20;
const MAX_TITLE_CHARS = 80;

/** One line, bounded: a watchlist card is JSON the client sent. */
const clean = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE_CHARS);
const kind = (type: unknown) => (type === "tv" ? "series" : "film");

async function feedTitles(userId: string, dna: DNASchema): Promise<string[]> {
  // The feed has one cached list per picker choice; Both comes first because the feed opens on it.
  const lists = await Promise.all(
    (["all", "movies", "series"] as const).map((t) =>
      getCachedRecommendations(userId, dna.metadata.taste_version, t),
    ),
  );
  const rated = new Set(dna.signals.map((s) => titleKey(s.type, s.tmdb_id)));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of lists.flatMap((l) => l ?? [])) {
    const key = titleKey(r.type, r.tmdb_id);
    if (seen.has(key) || rated.has(key)) continue;
    seen.add(key);
    out.push(`${clean(r.title)} (${kind(r.type)})`);
    if (out.length === FEED_TITLES) break;
  }
  return out;
}

async function watchlistTitles(supabase: SupabaseClient, userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("watchlist_entries")
    .select("rec")
    .eq("user_id", userId)
    .is("rating", null) // still to watch: a rated or removed save stays in the table, tagged
    .order("added_at", { ascending: false })
    .limit(WATCHLIST_TITLES);
  if (error) throw new Error(error.message);
  return ((data ?? []) as { rec: { title?: unknown; type?: unknown; year?: unknown } | null }[])
    .filter((row) => typeof row.rec?.title === "string" && row.rec.title.trim())
    .map((row) => {
      const year = typeof row.rec!.year === "number" && row.rec!.year > 0 ? `, ${row.rec!.year}` : "";
      return `${clean(row.rec!.title as string)} (${kind(row.rec!.type)}${year})`;
    });
}

/** The block appended to the consultant's instructions, or '' when both lists are empty. */
export async function consultantContext(
  supabase: SupabaseClient,
  userId: string,
  dna: DNASchema,
): Promise<string> {
  const [feed, watchlist] = await Promise.all([
    feedTitles(userId, dna).catch((e) => {
      console.error("[conversation] feed titles unavailable", e instanceof Error ? e.message : e);
      return [] as string[];
    }),
    watchlistTitles(supabase, userId).catch((e) => {
      console.error("[conversation] watchlist titles unavailable", e instanceof Error ? e.message : e);
      return [] as string[];
    }),
  ]);
  const lines: string[] = [];
  if (feed.length) lines.push(`IN THEIR RECOMMENDATIONS NOW (best match first): ${feed.join("; ")}.`);
  if (watchlist.length) lines.push(`ON THEIR WATCHLIST (newest first): ${watchlist.join("; ")}.`);
  return lines.length ? `\n\n${lines.join("\n")}` : "";
}
