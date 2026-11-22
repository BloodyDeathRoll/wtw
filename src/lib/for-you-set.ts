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
// F4 (resting, FOR-YOU.md DEC-6, #351): at Refresh, the outgoing cards you stopped on and left alone rest, then retire;
// every new 20 leaves out the resting and retired ones and keeps a returning one out of the top five (`restBook`
// below, rules in src/lib/resting.ts). F8 keeps the 20 on the phone and checks this set behind them.

import { createServiceClient } from "@/lib/supabase/service";
import { ofContentType, servableFilter, toCards } from "@/lib/rec-page";
import { titleKey } from "@/lib/title-key";
import { startTimer } from "@/lib/timing";
import { NO_REST, placeReturning, restPlan, restSeconds, type RestPlan, type RestRow } from "@/lib/resting";
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
 *
 * `rest` (F4, DEC-6): resting and retired titles are left out altogether, even as a top-up; a title back from its rest
 * is never in the top five. Without it (FOR_YOU_V3's F1 alone, or the rest state unread), the 20 are as F1 made them.
 */
export function pickTheTwenty(
  batch: RecommendationResult[],
  servable: (r: RecommendationResult) => boolean,
  previous: RecommendationResult[] = [],
  rest: RestPlan = NO_REST,
): RecommendationResult[] {
  const before = new Set(previous.map((r) => titleKey(r.type, r.tmdb_id)));
  const picked: RecommendationResult[] = [];
  const taken = new Set<string>();
  const take = (r: RecommendationResult) => {
    const k = titleKey(r.type, r.tmdb_id);
    if (picked.length >= SET_SIZE || taken.has(k) || rest.blocked.has(k) || !servable(r)) return;
    taken.add(k);
    picked.push(r);
  };
  for (const r of batch) if (!before.has(titleKey(r.type, r.tmdb_id))) take(r);
  for (const r of batch) if (before.has(titleKey(r.type, r.tmdb_id))) take(r);
  for (const r of previous) take(r);
  return rest.returning.size > 0 ? placeReturning(picked, (r) => rest.returning.has(titleKey(r.type, r.tmdb_id))) : picked;
}

/**
 * F4 (FOR-YOU.md DEC-6): the rest state the next 20 is drawn with. At a Refresh (`skippable` = the outgoing 20 minus
 * what was added, rated or hidden), first count the skips: each of those stopped on since that 20 was made gets one more
 * skip and its rest (migration 0035's `rest_skipped_titles`). Then read every title with a skip.
 *
 * Never fails a Refresh: when the state can't be read (or migration 0035 isn't there), the 20 are drawn as F1 draws them.
 */
export async function restBook(
  userId: string,
  contentType: ContentType,
  skippable: RecommendationResult[] = [],
): Promise<RestPlan> {
  try {
    const db = createServiceClient();
    if (skippable.length > 0) {
      const { data: setRow, error: madeError } = await db
        .from(TABLE)
        .select("made_at")
        .eq("user_id", userId)
        .eq("content_type", contentType)
        .maybeSingle<{ made_at: string | null }>();
      if (madeError) throw new Error(`the outgoing 20's time: ${madeError.message}`);
      if (setRow?.made_at) {
        const { error } = await db.rpc("rest_skipped_titles", {
          p_user_id: userId,
          p_keys: skippable.map((r) => titleKey(r.type, r.tmdb_id)),
          p_since: setRow.made_at,
          p_rest_secs: restSeconds(),
        });
        // The skips not counted this time stay marked; the read below still keeps resting titles out.
        if (error) console.warn("[for-you-set] counting the skips failed (non-fatal):", error.message);
      }
    }
    const { data, error } = await db
      .from("served_titles")
      .select("tmdb_id, media_type, skips, rest_until")
      .eq("user_id", userId)
      .gt("skips", 0);
    if (error) throw new Error(error.message);
    const rows: RestRow[] = ((data ?? []) as { tmdb_id: string; media_type: "movie" | "tv"; skips: number; rest_until: string | null }[])
      .map((r) => ({ key: titleKey(r.media_type, r.tmdb_id), skips: r.skips, rest_until: r.rest_until }));
    return restPlan(rows);
  } catch (err) {
    console.warn("[for-you-set] rest state unread, drawing the 20 without it:", err instanceof Error ? err.message : err);
    return NO_REST;
  }
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
  const open = (r: RecommendationResult) => servable(r) && !saved.has(titleKey(r.type, r.tmdb_id));
  // F4: the outgoing cards still open (not added, rated or hidden) are the ones that can count as skipped.
  const rest = await restBook(userId, contentType, (opts.previous ?? []).filter(open));
  const set = pickTheTwenty(pool, open, opts.previous, rest);
  try {
    if (set.length > 0) await saveForYouSet(userId, contentType, set, dna?.metadata.taste_version ?? null);
  } catch (err) {
    if (mustKeep) throw err;
    console.warn("[for-you-set] keeping the 20 failed (non-fatal):", err instanceof Error ? err.message : err);
  }
  return serveTheTwenty({ userId, dna, set, removed, source, fresh: true });
}
