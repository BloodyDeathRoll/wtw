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
import { normTitle, type KnownTitles } from "./grounding";
import type { createClient } from "@/lib/supabase/server";
import type { DNASchema } from "@/types/dna";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

// Sent with every turn, so a short list: the top of the feed and the newest
// saves. The feed list is in match order only within one picker choice.
const FEED_TITLES = 20;
const WATCHLIST_TITLES = 20;
const MAX_TITLE_CHARS = 80;

/**
 * One line, bounded: a watchlist card is JSON the client sent, and its title
 * ends up inside the model's instructions. It is the person's own chat, so the
 * most a crafted title does is confuse their own answers; the prompt also
 * tells the model the lists are titles, not instructions.
 */
const clean = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE_CHARS);
const kind = (type: unknown) => (type === "tv" ? "series" : "film");

/** Remembers a title the person already holds, so the reply check needs no search for it (grounding.ts). */
function note(known: KnownTitles, title: string, key: string) {
  const n = normTitle(title);
  known.set(n, [...(known.get(n) ?? []), key]);
}

async function feedTitles(userId: string, dna: DNASchema, rated: ReadonlySet<string>, known: KnownTitles): Promise<string[]> {
  // The feed has one cached list per picker choice; Both comes first because the feed opens on it.
  const lists = await Promise.all(
    (["all", "movies", "series"] as const).map((t) =>
      getCachedRecommendations(userId, dna.metadata.taste_version, t),
    ),
  );
  // A miss (a new taste_version, or 6 h without a build), not a failure: a failed read throws.
  if (lists.every((l) => !l)) console.log("[conversation] no cached feed for the consultant");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of lists.flatMap((l) => l ?? [])) {
    const key = titleKey(r.type, r.tmdb_id);
    if (seen.has(key) || rated.has(key)) continue;
    seen.add(key);
    note(known, r.title, key);
    if (out.length < FEED_TITLES) out.push(`${clean(r.title)} (${kind(r.type)})`);
  }
  return out;
}

async function watchlistTitles(supabase: SupabaseClient, userId: string, rated: ReadonlySet<string>, known: KnownTitles): Promise<string[]> {
  const { data, error } = await supabase
    .from("watchlist_entries")
    .select("rec_id, rec")
    .eq("user_id", userId)
    .is("rating", null) // still to watch: a rated or removed save stays in the table, tagged
    .order("added_at", { ascending: false })
    .limit(WATCHLIST_TITLES * 2); // room for the saves dropped below
  if (error) throw new Error(error.message);
  return ((data ?? []) as { rec_id: string; rec: { title?: unknown; type?: unknown; year?: unknown } | null }[])
    // A save rated somewhere else (a feed card, the ratings page) keeps `rating` null here; rec_id is "type:tmdb_id".
    .filter((row) => !rated.has(row.rec_id) && typeof row.rec?.title === "string" && row.rec.title.trim())
    .slice(0, WATCHLIST_TITLES)
    .map((row) => {
      note(known, row.rec!.title as string, row.rec_id);
      const year = typeof row.rec!.year === "number" && row.rec!.year > 0 ? `, ${row.rec!.year}` : "";
      return `${clean(row.rec!.title as string)} (${kind(row.rec!.type)}${year})`;
    });
}

export interface ConsultantContext {
  /** The block appended to the consultant's instructions; '' when both lists are empty. */
  text: string;
  /** The person's feed, watchlist and rated titles: ours without a search. */
  known: KnownTitles;
}

export async function consultantContext(
  supabase: SupabaseClient,
  userId: string,
  dna: DNASchema,
): Promise<ConsultantContext> {
  const known: KnownTitles = new Map();
  for (const s of dna.signals) note(known, s.title, titleKey(s.type, s.tmdb_id));
  const rated = new Set(dna.signals.map((s) => titleKey(s.type, s.tmdb_id)));
  const [feed, watchlist] = await Promise.all([
    feedTitles(userId, dna, rated, known).catch((e) => {
      console.error("[conversation] feed titles unavailable", e instanceof Error ? e.message : e);
      return [] as string[];
    }),
    watchlistTitles(supabase, userId, rated, known).catch((e) => {
      console.error("[conversation] watchlist titles unavailable", e instanceof Error ? e.message : e);
      return [] as string[];
    }),
  ]);
  const lines: string[] = [];
  if (feed.length) lines.push(`IN THEIR RECOMMENDATIONS NOW: ${feed.join("; ")}.`);
  if (watchlist.length) lines.push(`ON THEIR WATCHLIST (newest first): ${watchlist.join("; ")}.`);
  return { text: lines.length ? `\n\n${lines.join("\n")}` : "", known };
}
