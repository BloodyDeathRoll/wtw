/**
 * v3 F8 (FAST_TABS; docs/plan/v3/PLAN.md §4 F8): For you keeps its 20 on the phone between tabs.
 *
 * Leaving For you unmounts its list; without this, coming back empties it and reads the 20 again behind the loader.
 * Here the list is kept as it was on screen — the cards, the chips you lit, the Hide notes — per person and per list
 * (Movies, Series, Both), for as long as the app is open (memory only: a reload reads the 20 again, as today). Coming
 * back paints it at once, and a quiet read behind it swaps in the server's 20 only if they changed: a Refresh on
 * another device brings titles this list never had.
 *
 * A rating or a hide made elsewhere while For you is closed (Search, Seen, the Watchlist) is written into the kept
 * list too, the way the server would show it on the next read.
 */
import type { ContentType } from "@/lib/content-type";
import type { WatchlistRating } from "@/lib/watchlist";
import type { Recommendation } from "@/types/recommendation";
import { HIDDEN_EVENT, RATED_EVENT, type HiddenDetail, type RatedDetail } from "./rate";

export interface HeldTwenty {
  /** The cards on screen, in order. */
  recs: Recommendation[];
  /** The ids the server's 20 had when they last came in: a later read with any other title is a new 20. */
  served: string[];
  /** The outcome chips lit, by rec id. */
  feedbackGiven: Record<string, WatchlistRating>;
  /** Cards folded into their Hide note, by rec id (kept as 0: the note shows without the fold animation again). */
  hidden: Record<string, number>;
  tasteVersion: number | null;
}

const held = new Map<string, HeldTwenty>();
let listening = false;

const keyOf = (userId: string, contentType: ContentType) => `${userId}:${contentType}`;

export function heldTwenty(userId: string | undefined, contentType: ContentType): HeldTwenty | null {
  return userId ? held.get(keyOf(userId, contentType)) ?? null : null;
}

/** Whether anything is kept for this person (any list): the home route then opens without its first-load wait. */
export function holdsTwenty(userId: string): boolean {
  for (const k of held.keys()) if (k.startsWith(`${userId}:`)) return true;
  return false;
}

export function holdTwenty(userId: string, contentType: ContentType, twenty: HeldTwenty): void {
  listen();
  held.set(keyOf(userId, contentType), {
    ...twenty,
    hidden: Object.fromEntries(Object.keys(twenty.hidden).map((id) => [id, 0])),
  });
}

/**
 * The server's 20 against the kept ones: changed only if it has a title the kept 20 never had (a Refresh elsewhere).
 * Fewer titles is the same 20: the server drops a title once it's hidden or saved elsewhere, and the kept list shows
 * those as you left them.
 */
export function isNewTwenty(kept: Pick<HeldTwenty, "served">, server: readonly Pick<Recommendation, "id">[]): boolean {
  const known = new Set(kept.served);
  return server.some((r) => !known.has(r.id));
}

function listen(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener(RATED_EVENT, (e) => {
    const { id, rating } = (e as CustomEvent<RatedDetail>).detail;
    for (const t of held.values()) {
      if (!t.recs.some((r) => r.id === id)) continue;
      const next = { ...t.feedbackGiven };
      if (rating) next[id] = rating;
      else delete next[id];
      t.feedbackGiven = next;
    }
  });
  window.addEventListener(HIDDEN_EVENT, (e) => {
    const { id, hidden } = (e as CustomEvent<HiddenDetail>).detail;
    for (const t of held.values()) {
      if (!t.recs.some((r) => r.id === id)) continue;
      const next = { ...t.hidden };
      if (hidden) next[id] = 0;
      else delete next[id];
      t.hidden = next;
    }
  });
}

/** Tests only. */
export function forgetHeldForTests(): void {
  held.clear();
}
