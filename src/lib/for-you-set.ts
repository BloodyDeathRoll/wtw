// v3 F1 (docs/plan/v3/FOR-YOU.md DEC-1–3, issue #349): the 20.
//
// For you shows a set of about 20 picks that stays exactly as it is (same titles, same order, same match and line) until
// the person taps Refresh. The set is kept here, per person and per picker setting (Movies / Series / Both), in
// `for_you_sets` (migration 0038), so leaving and coming back, a new day or another device shows the same 20.
//
// Made from a batch of 50 (the engine's), the first time For you opens with FOR_YOU_V3 on, and again at every Refresh.
// Read: the stored engine results, rebuilt into cards. What the person did since (rated, saved, hid) drops out on the
// way, as on today's feed; F2 changes that to "stays on the card, lit, until Refresh".
//
// For what comes next: F4 (resting) reads the outgoing set at Refresh (`previous` below) and adds what it needs to
// served_titles; F8 keeps the 20 on the phone and checks this set behind them.

import { createServiceClient } from "@/lib/supabase/service";
import { ofContentType, servableFilter, toCards } from "@/lib/rec-page";
import { titleKey } from "@/lib/title-key";
import { startTimer } from "@/lib/timing";
import type { ContentType } from "@/lib/content-type";
import type { DNASchema, RecommendationResult } from "@/types/dna";
import type { RecPage } from "@/types/recommendation";

/** "Your 20 picks". */
export const SET_SIZE = 20;

const TABLE = "for_you_sets";

/** The stored 20 for this picker setting, in order; null when none was made yet. Throws when the read fails. */
export async function readForYouSet(userId: string, contentType: ContentType): Promise<RecommendationResult[] | null> {
  const { data, error } = await createServiceClient()
    .from(TABLE)
    .select("recs")
    .eq("user_id", userId)
    .eq("content_type", contentType)
    .maybeSingle<{ recs: RecommendationResult[] | null }>();
  if (error) throw new Error(`for_you_sets read failed: ${error.message}`);
  return Array.isArray(data?.recs) && data.recs.length > 0 ? data.recs : null;
}

/** Keep `recs` as this setting's 20 (replacing the last). Throws when the write fails. */
export async function saveForYouSet(
  userId: string,
  contentType: ContentType,
  recs: RecommendationResult[],
  tasteVersion: number | null,
): Promise<void> {
  const { error } = await createServiceClient()
    .from(TABLE)
    .upsert(
      { user_id: userId, content_type: contentType, recs, taste_version: tasteVersion, made_at: new Date().toISOString() },
      { onConflict: "user_id,content_type" },
    );
  if (error) throw new Error(`for_you_sets write failed: ${error.message}`);
}

/**
 * A title in any of this person's 20s, for "Why it's a match" once the batch cache it came from has expired (6 hours)
 * or moved on (a rating refresh). Null when it isn't in one or the read fails: the sheet then says what it says today.
 */
export async function findInForYouSets(
  userId: string,
  tmdbId: string,
  type: "movie" | "tv" | null,
): Promise<RecommendationResult | null> {
  try {
    const { data, error } = await createServiceClient().from(TABLE).select("recs").eq("user_id", userId);
    if (error) return null;
    for (const row of (data ?? []) as { recs: RecommendationResult[] | null }[]) {
      const hit = (row.recs ?? []).find((r) => r.tmdb_id === tmdbId && (!type || r.type === type));
      if (hit) return hit;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * The titles on this person's Watchlist (watchlist_entries), as `type:tmdb_id`. The fingerprint's saved marks miss a
 * title saved where no marker is written (Search, the games: #412), and the screen then hides it from the 20, leaving
 * 19 under "Your 20 picks". Read where the 20 are made, so they are 20 Watchlist-free picks. Empty when the read fails.
 */
async function watchlistKeys(userId: string): Promise<Set<string>> {
  try {
    const { data, error } = await createServiceClient().from("watchlist_entries").select("rec_id").eq("user_id", userId);
    if (error) throw new Error(error.message);
    return new Set(((data ?? []) as { rec_id: string }[]).map((r) => r.rec_id));
  } catch (err) {
    console.warn("[for-you-set] Watchlist read failed (non-fatal):", err instanceof Error ? err.message : err);
    return new Set();
  }
}

/**
 * The next 20 from a batch: the best servable titles in the batch's order, leaving out the outgoing 20 so Refresh
 * brings new picks (FOR-YOU.md DEC-3). When the batch can't fill 20 without them, the outgoing ones still servable
 * top it up, so a set is never short just because the pool is.
 */
export function pickTheTwenty(
  batch: RecommendationResult[],
  servable: (r: RecommendationResult) => boolean,
  previous: RecommendationResult[] = [],
): RecommendationResult[] {
  const before = new Set(previous.map((r) => titleKey(r.type, r.tmdb_id)));
  const picked: RecommendationResult[] = [];
  const taken = new Set<string>();
  const take = (r: RecommendationResult) => {
    const k = titleKey(r.type, r.tmdb_id);
    if (picked.length >= SET_SIZE || taken.has(k) || !servable(r)) return;
    taken.add(k);
    picked.push(r);
  };
  for (const r of batch) if (!before.has(titleKey(r.type, r.tmdb_id))) take(r);
  for (const r of batch) if (before.has(titleKey(r.type, r.tmdb_id))) take(r);
  for (const r of previous) take(r);
  return picked;
}

/** The stored 20 as a page: every card still servable, in the set's order. No paging: `has_more` is false. */
export async function serveTheTwenty(opts: {
  userId: string;
  dna: DNASchema | null;
  set: RecommendationResult[];
  removed: Set<string> | Promise<Set<string>>;
  source: string;
  /** A set made just now: check the services and record what was shown. A stored set was recorded when made. */
  fresh: boolean;
}): Promise<RecPage> {
  const { userId, dna, set, source, fresh } = opts;
  const timer = startTimer("for-you-set");
  const servable = await servableFilter(dna, await opts.removed, set);
  const items = set.filter(servable);
  const recommendations = await toCards(userId, items, { record: fresh, timer });
  return {
    recommendations,
    next_offset: set.length,
    has_more: false,
    source,
    taste_version: dna?.metadata.taste_version ?? null,
    set: true,
  };
}

/**
 * Make this setting's 20 from `batch`, keep it, and serve it. `previous` is the set it replaces (Refresh). `mustKeep`:
 * a Refresh whose new 20 can't be kept fails, so the person isn't shown a set the next visit wouldn't show; a first set
 * that can't be kept is still served (the next visit makes one again).
 */
export async function makeTheTwenty(opts: {
  userId: string;
  dna: DNASchema | null;
  batch: RecommendationResult[];
  removed: Set<string> | Promise<Set<string>>;
  contentType: ContentType;
  previous?: RecommendationResult[];
  source: string;
  mustKeep: boolean;
}): Promise<RecPage> {
  const { userId, dna, contentType, source, mustKeep } = opts;
  const [removed, saved] = await Promise.all([opts.removed, watchlistKeys(userId)]);
  const pool = ofContentType(opts.batch, contentType);
  const servable = await servableFilter(dna, removed, [...pool, ...(opts.previous ?? [])]);
  const set = pickTheTwenty(pool, (r) => servable(r) && !saved.has(titleKey(r.type, r.tmdb_id)), opts.previous);
  try {
    if (set.length > 0) await saveForYouSet(userId, contentType, set, dna?.metadata.taste_version ?? null);
  } catch (err) {
    if (mustKeep) throw err;
    console.warn("[for-you-set] keeping the 20 failed (non-fatal):", err instanceof Error ? err.message : err);
  }
  return serveTheTwenty({ userId, dna, set, removed, source, fresh: true });
}
