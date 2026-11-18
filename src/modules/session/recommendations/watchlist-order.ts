/**
 * The Watchlist's order, filters and chip counts (docs/plan/v3/WATCHLIST.md,
 * DEC-3 to DEC-7). Pure: the view and the tests both read it.
 *
 *   order   starred (newest saved first), then the rest (newest first), then,
 *           under a "Seen" line, the rated titles (newest first). Nothing
 *           leaves by rating; only Remove takes a title off (DEC-5).
 *   chips   All · Starred · Movies · Series · one per Israeli service with at
 *           least one title on the list · Seen; one lit at a time. A chip's
 *           count is its part of the list; All is the whole list, rated titles
 *           included (DEC-6).
 */

import type { WatchlistEntry } from "@/lib/watchlist";
import { ISRAEL_SERVICES } from "@/lib/watch-providers";

export type WatchlistFilter = "all" | "starred" | "movies" | "series" | "seen" | `service:${string}`;

/**
 * Service chips only while the region's known services are few (Eran,
 * 2026-11-18, DEC-3): at most this many, and each a chip of its own. Israel has
 * four, so chips. Above the limit (the US has 11 on one list alone) the
 * services become one "Services" filter control that opens a picker, to be
 * built when a second region arrives (WATCHLIST.md §+ "Region").
 */
export const MAX_SERVICE_CHIPS = 5;

export interface WatchlistChip {
  filter: WatchlistFilter;
  label: string;
  count: number;
}

/** Rated with a reaction. The old X's "removed" tag is not one. */
export function isSeen(e: WatchlistEntry): boolean {
  return e.rating === "loved" || e.rating === "liked" || e.rating === "disliked";
}

/** Starred first, then newest saved first. Stable, so ties keep storage order. */
function byPlace(a: WatchlistEntry, b: WatchlistEntry): number {
  if (a.starred !== b.starred) return a.starred ? -1 : 1;
  return b.added_at - a.added_at;
}

/** The list in its two parts: above and below the "Seen" line. */
export function orderWatchlist(entries: readonly WatchlistEntry[]): { unseen: WatchlistEntry[]; seen: WatchlistEntry[] } {
  const unseen = entries.filter((e) => !isSeen(e)).sort(byPlace);
  const seen = entries.filter(isSeen).sort(byPlace);
  return { unseen, seen };
}

export function matchesFilter(e: WatchlistEntry, filter: WatchlistFilter): boolean {
  switch (filter) {
    case "all": return true;
    case "starred": return e.starred;
    case "movies": return e.rec.type === "movie";
    case "series": return e.rec.type === "tv";
    case "seen": return isSeen(e);
    default: return e.rec.where_il === filter.slice("service:".length);
  }
}

export function filterWatchlist(entries: readonly WatchlistEntry[], filter: WatchlistFilter): WatchlistEntry[] {
  return entries.filter((e) => matchesFilter(e, filter));
}

export function watchlistChips(entries: readonly WatchlistEntry[]): WatchlistChip[] {
  const count = (filter: WatchlistFilter) => filterWatchlist(entries, filter).length;
  const chips: WatchlistChip[] = [
    { filter: "all", label: "All", count: entries.length },
    { filter: "starred", label: "Starred", count: count("starred") },
    { filter: "movies", label: "Movies", count: count("movies") },
    { filter: "series", label: "Series", count: count("series") },
  ];
  // One chip per service with at least one title; none at all above the limit
  // (a single "Services" control takes their place then; not built yet).
  if (ISRAEL_SERVICES.length <= MAX_SERVICE_CHIPS) {
    for (const s of ISRAEL_SERVICES) {
      const filter: WatchlistFilter = `service:${s.label}`;
      const n = count(filter);
      if (n > 0) chips.push({ filter, label: s.label, count: n });
    }
  }
  chips.push({ filter: "seen", label: "Seen", count: count("seen") });
  return chips;
}

/** A filter with nothing behind it says so in one line; the chip stays lit (DEC-3). */
export function emptyFilterText(filter: WatchlistFilter): string {
  switch (filter) {
    case "starred": return "Nothing starred yet. Star a title and it stays at the top of your list.";
    case "movies": return "No movies on your list yet.";
    case "series": return "No series on your list yet.";
    case "seen": return "Nothing seen yet. Rate a title on your list and it moves down here.";
    case "all": return "Nothing saved yet. Tap “Add to Watchlist” on a recommendation to keep it here.";
    default: return `Nothing on ${filter.slice("service:".length)} on your list.`;
  }
}

/** The reaction a Seen row shows in place of its match (DEC-5). */
export const SEEN_LABEL: Record<"loved" | "liked" | "disliked", string> = {
  loved: "❤️ Loved",
  liked: "👍 Liked",
  disliked: "👎 Disliked",
};
