// One page of recommendation cards, built from a cached or fresh batch.
//
// Moved unchanged out of GET /api/recommendations/generate (2026-11-13) so
// POST /api/session/end can hand "Find more" its first page in the same
// response: the separate GET cost a round trip of ~1.6 s (measured).

import { after } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { startTimer } from "@/lib/timing";
import { ensureWatchProviders } from "@/modules/engine/enrichment/ensure-watch-providers";
import { isExcluded, type MatchableTitle } from "@/lib/exclusion-rules";
import {
  tmdbPosterUrl,
  youtubeTrailerUrl,
  primaryWatchProvider,
  type WatchProviderMap,
} from "@/lib/tmdb";
import { titleKey, recordKey, matchesKeySet, isSavedMarker } from "@/lib/title-key";
import { titleTypeFor, type ContentType } from "@/lib/content-type";
import { displayMatch } from "@/modules/engine/match-display";
import { servedFormula } from "@/modules/engine/live-score";
import type { DNASchema, RecommendationResult } from "@/types/dna";
import type { Recommendation, MotifKind, RecPage } from "@/types/recommendation";

const DEFAULT_PAGE_SIZE = 6;


// Which region's streaming availability the card's service line reports.
// Deliberately a constant, not an env var (decided 2026-08-26): the nightly
// script stores exactly this region (WATCH_REGIONS in grow-catalog.mts), and
// two independently-set env vars would silently blank the line if they ever
// drifted. Change both together, or better, make it per-user — the recs come
// from a shared cache, so that means putting the region in the cache key.
const WATCH_REGION = "US";

// Deterministic motif/palette fallback for titles without a poster,
// keyed stably off tmdb_id.
const MOTIFS: MotifKind[] = ["spades", "circle", "star", "cross", "dot", "wave"];
const PALETTES: [string, string][] = [
  ["#1B2A28", "#C7B8FF"],
  ["#2A1B24", "#FFD9A0"],
  ["#1B2333", "#9AD1FF"],
  ["#241B2E", "#F2A0E8"],
  ["#1E2A1B", "#B8FFC7"],
  ["#2E241B", "#FFC79A"],
];
function hashId(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

/**
 * The user's suppression list as a Set of `${media_type}:${tmdb_id}` keys —
 * the same shape as a Recommendation.id and `${result.type}:${tmdb_id}`.
 * Removed titles are filtered out of every served page so a title the user
 * "Removed" is never shown again, even if it's still in the Redis cache.
 */
export async function getRemovedKeys(userId: string): Promise<Set<string>> {
  try {
    const db = createServiceClient();
    const { data } = await db
      .from("removed_titles")
      .select("tmdb_id, media_type")
      .eq("user_id", userId);
    return new Set((data ?? []).map((r) => `${r.media_type}:${r.tmdb_id}`));
  } catch (err) {
    console.error(
      "[recommendations/generate] removed-list read failed:",
      err instanceof Error ? err.message : err,
    );
    return new Set();
  }
}

/**
 * Adapt engine RecommendationResult → the UI's Recommendation shape
 * (src/types/recommendation.ts). The engine result is the shared contract and
 * carries no display fields; per that type's comment, THIS route adapts the
 * source to what the UI renders — id, year, meta, rating, match, reason,
 * poster_url (joined from `titles` on (tmdb_id, type)), motif/palette fallback.
 */
/**
 * Catalog fields for the user's exclusion rules, keyed `type:tmdb_id`.
 *
 * A rule written today cannot retroactively empty a batch generated
 * yesterday: the cache is keyed by taste_version, and adding a rule bumps it,
 * but a batch can still be in flight or the version bump can be skipped. This
 * is the read-side guarantee — a title the user has forbidden never renders,
 * whatever the cache holds. One query per page-serve, only when rules exist.
 */
async function fetchRuleFields(
  recs: RecommendationResult[],
): Promise<Map<string, MatchableTitle>> {
  if (recs.length === 0) return new Map();
  const db = createServiceClient();
  const { data, error } = await db
    .from("titles")
    .select("tmdb_id, type, genres, keywords, original_language, tone_tags, crew")
    .in("tmdb_id", recs.map((r) => r.tmdb_id));
  if (error) {
    // Fail open on the metadata read: dropping the whole page because Postgres
    // blipped is worse than one page that slips a rule for one request.
    console.warn("[recommendations/generate] rule-field read failed (non-fatal):", error.message);
    return new Map();
  }
  return new Map(
    (data ?? []).map((t) => [`${t.type}:${t.tmdb_id}`, t as MatchableTitle]),
  );
}

async function toUIRecommendations(
  recs: RecommendationResult[],
): Promise<Recommendation[]> {
  if (recs.length === 0) return [];
  const db = createServiceClient();
  const { data } = await db
    .from("titles")
    .select("tmdb_id, type, poster_path, trailer_key, release_year, runtime_minutes, tmdb_rating, watch_providers")
    .in("tmdb_id", recs.map((r) => r.tmdb_id));
  const byKey = new Map(
    (data ?? []).map((t) => [`${t.type}:${t.tmdb_id}`, t]),
  );

  return recs.map((r) => {
    const t = byKey.get(`${r.type}:${r.tmdb_id}`);
    const h = hashId(r.tmdb_id);
    const runtime = (t?.runtime_minutes as number | null) ?? null;
    const meta =
      r.type === "movie"
        ? runtime
          ? `${Math.floor(runtime / 60)}h ${runtime % 60}m`
          : "Film"
        : runtime
          ? `~${runtime}m episodes`
          : "Series";
    return {
      id: `${r.type}:${r.tmdb_id}`,          // stable — feedback + React keys
      title: r.title,
      type: r.type,
      year: (t?.release_year as number | null) ?? 0,
      poster_url: tmdbPosterUrl(t?.poster_path as string | null | undefined),
      trailer_url: youtubeTrailerUrl(t?.trailer_key as string | null | undefined),
      meta,
      rating: (t?.tmdb_rating as number | null) ?? 0,
      // v1: rescaled so a best fit reads ~100%. v2: the pool percentile,
      // capped at 97% (DEC-10). Display-only (src/modules/engine/match-display.ts).
      match: displayMatch(r.composite_score),
      reason: r.explanation || "Matched to your fingerprint",
      // Flatrate streaming availability for the deployment's region
      // (migration 0017, filled nightly by grow-catalog.mts §3c). Null when
      // the row was never checked or the title streams nowhere here — the UI
      // hides the line rather than guessing.
      where: primaryWatchProvider(
        t?.watch_providers as WatchProviderMap | null | undefined,
        WATCH_REGION,
      ),
      is_stretch_pick: r.is_stretch_pick,
      motif: MOTIFS[h % MOTIFS.length],
      palette: PALETTES[h % PALETTES.length],
    };
  });
}

// Type-filter → drop removed + already-judged titles → paginate → adapt to the
// UI shape. Used for both the warm cache and a freshly regenerated list so
// their handling can't drift apart.
export async function buildRecPage(opts: {
  userId: string;
  dna: DNASchema | null;
  recs: RecommendationResult[];
  /** Titles the user has "Removed" (getRemovedKeys); a promise lets the caller start the read early. */
  removed: Set<string> | Promise<Set<string>>;
  /** Position in the batch to start from. */
  start: number;
  contentType: ContentType;
  source: string;
}): Promise<RecPage> {
  const { userId, dna, recs, start, contentType, source } = opts;
  const removed = await opts.removed;
  const timer = startTimer("rec-page");

  /**
   * Titles the user has already judged, as `${type}:${tmdb_id}` keys.
   *
   * dna.signals is the same set step1 candidate-gen excludes, so a title that
   * has been loved / liked / disliked (or named in chat) is never generated
   * again. But the SERVED list can still hold one: the Redis cache was built
   * before the rating, and a plain GET has no reason to regenerate. Filtering
   * here is what makes "once judged, never recommended again" hold on the read
   * path too, not just the write path.
   *
   * Composite key, never a bare tmdb_id — TMDB movie and TV ids collide, and
   * keying on the id alone would drop an unrelated title of the other type
   * (issue #30 / migration 0014).
   *
   * Removal is tracked separately in removed_titles, so restoring a title there
   * genuinely brings it back — unless it was also rated, which is its own,
   * stronger judgement.
   */
  const judged = new Set((dna?.signals ?? []).map((s) => titleKey(s.type, s.tmdb_id)))
  // Watchlisted titles are excluded too (decided 2026-08-28): a saved title
  // resurfacing as a "new" recommendation reads as a repeat. The marker lives
  // in recommendation_history (see watchlist-intent.ts); legacy markers with
  // no type match on the bare id — see matchesKeySet.
  for (const h of dna?.learning_loop.recommendation_history ?? []) {
    if (isSavedMarker(h)) judged.add(recordKey(h))
  }

  const taste_version = dna?.metadata.taste_version ?? null;
  // The batch was generated for this content type, so this only guards a
  // cache entry written before the split.
  const wanted = titleTypeFor(contentType);
  const typeFiltered = wanted ? recs.filter((r) => r.type === wanted) : recs;

  // The user's standing rules, applied to whatever the cache handed us.
  const rules = dna?.contextual_logic?.exclusion_rules ?? [];
  const fields = rules.length > 0 ? await fetchRuleFields(typeFiltered) : null;
  timer.mark("rule fields");
  const servable = (r: RecommendationResult) => {
    if (removed.has(titleKey(r.type, r.tmdb_id)) || matchesKeySet(judged, r.type, r.tmdb_id)) return false;
    const t = fields?.get(`${r.type}:${r.tmdb_id}`);
    return !t || !isExcluded(t, rules);
  };

  // `offset` is a position in the cached batch, not in the filtered list.
  // The user rates and removes cards they have already been served, and each
  // of those drops out of the filtered list — so slicing the filtered list at
  // the client's offset started the next page that many titles too far on,
  // and those titles were never shown. Walk the batch from the offset instead,
  // skipping what isn't servable, so pages stay full-sized and nothing unseen
  // is passed over.
  const items: RecommendationResult[] = [];
  let cursor = start;
  while (cursor < typeFiltered.length && items.length < DEFAULT_PAGE_SIZE) {
    const r = typeFiltered[cursor++];
    if (servable(r)) items.push(r);
  }
  const nextOffset = cursor;
  const hasMore = typeFiltered.slice(cursor).some(servable);
  // Streaming availability for THIS page, before it renders: the batch-wide
  // check runs in the background after generation, so this is usually a
  // no-op — but a page served before it lands would otherwise show no
  // service name until a refetch. At most one TMDB call per card on the
  // page (≤6, in parallel); a failure just leaves the line off.
  try {
    await ensureWatchProviders(
      items.map((r) => ({ tmdb_id: r.tmdb_id, type: r.type })),
      { maxChecks: DEFAULT_PAGE_SIZE },
    );
  } catch (err) {
    console.warn("[recommendations/generate] page provider check failed (non-fatal):", err instanceof Error ? err.message : err);
  }
  timer.mark("watch providers");
  const uiRecs = await toUIRecommendations(items);
  timer.mark(`card rows (${items.length})`);
  // Remember what this user was actually shown (served_titles, migration
  // 0019): the next batch keeps these out of its "fresh" 80% and draws its
  // "seen" 20% from them until they're rated. With the score each card was
  // served with and the formula behind it (migration 0032), for the live
  // score (src/modules/engine/live-score.ts). After the response — a
  // bookkeeping write must never delay a page.
  if (items.length > 0) {
    const keys = items.map((r) => titleKey(r.type, r.tmdb_id));
    const scores = items.map((r) => r.composite_score);
    const formulas = items.map((r) => servedFormula(r));
    after(async () => {
      const { error } = await createServiceClient().rpc("record_served_titles", {
        p_user_id: userId,
        p_keys: keys,
        p_scores: scores,
        p_formulas: formulas,
      });
      if (error) console.warn("[recommendations/generate] record_served_titles failed (non-fatal):", error.message);
    });
  }
  return { recommendations: uiRecs, next_offset: nextOffset, has_more: hasMore, source, taste_version };
}
