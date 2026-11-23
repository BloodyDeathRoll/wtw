"use client";

/**
 * A title tapped in Search, under SEARCH_V3 (docs/plan/v3/SEARCH.md DEC-2, v3 Q1): the same card page as the
 * Watchlist's and Seen's (TitleCardPage), in that title's state for you — Add to Watchlist or Remove, Loved / Liked /
 * Disliked lit if you rated it, today's breakdown under them, where to watch in Israel, share and the trailer. A
 * rating lands in Seen and your taste through the same route a card uses anywhere else (DEC-4).
 *
 * Your match (v3 Q5, SEARCH.md DEC-3): the ring fills in when the engine scores the title for you now (M1, about a
 * second); the card doesn't wait for it. A title it can't score honestly (outside the catalogue, a cold-start
 * profile) shows no ring, and no older match stands in for today's (plan DEC-5).
 *
 * Not here yet: a save teaching your taste (Q6).
 */

import { useEffect, useRef, useState } from "react";
import type { Recommendation } from "@/types/recommendation";
import type { AppUser } from "@/modules/session/types";
import type { RatingsSummary } from "@/app/api/recommendations/ratings/route";
import { FEED_START_TYPE, isContentType, type ContentType } from "@/lib/content-type";
import { shareTitle } from "@/lib/share";
import {
  addToWatchlist,
  getWatchlist,
  removeFromWatchlist,
  setWatchlistRating,
  setWatchlistStarred,
  type WatchlistRating,
} from "@/lib/watchlist";
import { addToRegretQueue, removeFromRegretQueue } from "@/lib/regret-queue";
import { fetchFreshExplain, freshKey, getCachedExplain, setCachedExplain } from "@/lib/explain-cache";
import { TitleCardPage } from "@/modules/session/recommendations/RecommendationsView";
import { deleteRating, HIDDEN_EVENT, postRating, RATED_EVENT, type HiddenDetail, type RatedDetail, type Reaction } from "@/modules/session/recommendations/rate";

/**
 * Your rating of each title ("type:tmdb_id" → reaction, or "removed" for one hidden from For you): Seen's own list.
 * Read again when it's a minute old (an installed app can stay open for days), and kept current in between by every
 * rating that lands through rate.ts — the feed's, the Watchlist's and Search's. Search's rows mark each title from it
 * (SEARCH_V3, SEARCH.md DEC-5).
 */
const FRESH_MS = 60_000;
let mine: { at: number; list: Promise<Record<string, WatchlistRating>> } | null = null;
export function myRatings(): Promise<Record<string, WatchlistRating>> {
  if (!mine || Date.now() - mine.at > FRESH_MS) {
    const list = fetch("/api/recommendations/ratings")
      .then((r) => (r.ok ? (r.json() as Promise<RatingsSummary>) : null))
      .then(
        (d) =>
          Object.fromEntries([
            ...(d?.removed ?? []).map((i) => [`${i.media_type}:${i.tmdb_id}`, "removed"]),
            ...(d?.items ?? []).map((i) => [i.id, i.rating]),
          ]) as Record<string, WatchlistRating>,
      )
      .catch(() => {
        mine = null; // try again on the next card
        return {} as Record<string, WatchlistRating>;
      });
    mine = { at: Date.now(), list };
  }
  return mine.list;
}
if (typeof window !== "undefined") {
  window.addEventListener(RATED_EVENT, (e) => {
    const { id, rating } = (e as CustomEvent<RatedDetail>).detail;
    void mine?.list.then((m) => {
      if (rating) m[id] = rating;
      else delete m[id];
    });
  });
  window.addEventListener(HIDDEN_EVENT, (e) => {
    const { id, hidden } = (e as CustomEvent<HiddenDetail>).detail;
    void mine?.list.then((m) => applyHidden(m, id, hidden));
  });
}
/** A title hidden or restored: "removed" marks it only while no rating does (a rating outranks hidden). */
export function applyHidden(m: Record<string, WatchlistRating>, id: string, hidden: boolean) {
  if (hidden) m[id] ??= "removed";
  else if (m[id] === "removed") delete m[id];
}
/** For the tests: forget the list read this page load. */
export function forgetMyRatings() {
  mine = null;
}

/** The fact-built "why" line for one title (/api/recommendations/why-lines); null when there is none (not in our catalogue). */
async function whyLine(id: string): Promise<string | null> {
  if (!/^(movie|tv):\d+$/.test(id)) return null;
  try {
    const res = await fetch("/api/recommendations/why-lines", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [id] }),
    });
    if (!res.ok) return null;
    const { lines } = (await res.json()) as { lines: Record<string, string> | null };
    return lines?.[id] ?? null;
  } catch {
    return null;
  }
}

/** The list a rating's next batch is built for: the one this device last picked on For you (WTWApp keeps it). */
function contentType(): ContentType {
  try {
    const c = window.localStorage.getItem("wtw:contentType");
    if (isContentType(c)) return c;
  } catch {
    // Storage off.
  }
  return FEED_START_TYPE;
}

// Ratings go one at a time, as on the feed: the route folds each into the fingerprint in turn.
let queue: Promise<void> = Promise.resolve();

export default function SearchCard({ rec, user }: { rec: Recommendation; user: AppUser }) {
  const entry = () => getWatchlist().find((e) => e.rec.id === rec.id);
  const [saved, setSaved] = useState(() => !!entry());
  const [starred, setStarred] = useState(() => entry()?.starred ?? false);
  // A saved title's own tag first (the Watchlist's), then Seen's list once it's read.
  const [rated, setRated] = useState<WatchlistRating | undefined>(() => entry()?.rating ?? undefined);
  const [line, setLine] = useState<{ id: string; text: string | null } | null>(null);
  // What the server holds, and the newest tap: a failed write rolls back to the server's rating, and only if nothing was tapped since.
  const server = useRef(rated);
  const latest = useRef(0);
  const heard = useRef(false); // a rating of this title landed since the card opened: newer than Seen's list
  // Today's match, once the engine answers (the breakdown under the card asks the same request: one call).
  const [match, setMatch] = useState<{ id: string; value: number } | null>(() => {
    const today = getCachedExplain(freshKey(rec.id))?.match;
    return today ? { id: rec.id, value: today } : null;
  });

  useEffect(() => {
    const tmdbId = rec.id.split(":")[1];
    if (!tmdbId || getCachedExplain(freshKey(rec.id))?.match) return;
    let on = true;
    void fetchFreshExplain(rec.type, tmdbId).then((d) => {
      if (!d) return;
      setCachedExplain(freshKey(rec.id), d);
      if (on && d.match) setMatch({ id: rec.id, value: d.match });
    });
    return () => {
      on = false;
    };
  }, [rec.id, rec.type]);

  useEffect(() => {
    let on = true;
    void myRatings().then((r) => {
      // Seen's rating over the Watchlist's tag, unless a newer one landed meanwhile (here or elsewhere). A tap
      // here is newer than the list too: the chip keeps it, even with its write still on the way. A title hidden
      // from For you lights no chip here.
      if (on && r[rec.id] && r[rec.id] !== "removed" && !heard.current) {
        if (!latest.current) setRated((cur) => cur ?? r[rec.id]);
        server.current = r[rec.id];
      }
    });
    // A rating that lands elsewhere (another tab) is what a failed write here rolls back to.
    const onRated = (e: Event) => {
      const { id, rating } = (e as CustomEvent<RatedDetail>).detail;
      if (id !== rec.id) return;
      heard.current = true;
      server.current = rating ?? undefined;
    };
    window.addEventListener(RATED_EVENT, onRated);
    void whyLine(rec.id).then((text) => on && setLine({ id: rec.id, text }));
    return () => {
      on = false;
      window.removeEventListener(RATED_EVENT, onRated);
    };
  }, [rec.id]);

  const reasonPending = line?.id !== rec.id;
  // The why line built from facts, as the Watchlist shows; a title we don't have keeps its synopsis.
  const shown: Recommendation = {
    ...rec,
    reason: (!reasonPending && line?.text) || rec.reason,
    // Only today's match draws the ring; until it lands (or with none), no ring.
    match: match?.id === rec.id ? match.value : 0,
  };

  function rollBack(r: Recommendation, tap: number) {
    if (tap !== latest.current) return;
    setRated(server.current);
    setWatchlistRating(r.id, server.current ?? null);
  }

  function onFeedback(r: Recommendation, rating: Reaction) {
    if (rating === rated) return;
    const wasSaved = saved;
    const tap = ++latest.current;
    setRated(rating);
    setWatchlistRating(r.id, rating);
    queue = queue.then(async () => {
      const ok = await postRating(r, rating, contentType()).catch(() => false);
      if (!ok) return rollBack(r, tap);
      server.current = rating;
      // A saved title rated is one you watched: the 48-hour check-in, as from the Watchlist. Not for a dislike.
      if (wasSaved && (rating === "loved" || rating === "liked")) addToRegretQueue(r.id.split(":")[1] ?? r.id, r.title, r.type);
    });
  }

  function onUnrate(r: Recommendation) {
    if (!rated || rated === "removed") return;
    const tap = ++latest.current;
    setRated(undefined);
    setWatchlistRating(r.id, null);
    queue = queue.then(async () => {
      const ok = await deleteRating(r, contentType(), saved).catch(() => false);
      if (!ok) return rollBack(r, tap);
      server.current = undefined;
      removeFromRegretQueue(r.id.split(":")[1] ?? r.id, r.type);
    });
  }

  function onToggleWatchlist(r: Recommendation) {
    if (saved) {
      removeFromWatchlist(r.id);
      setStarred(false);
    } else {
      addToWatchlist(r);
      // Saved after rating it here: the list shows it under Seen with its reaction.
      if (rated && rated !== "removed") setWatchlistRating(r.id, rated);
    }
    setSaved(!saved);
  }

  return (
    <TitleCardPage
      rec={shown}
      saved={saved}
      starred={starred}
      onStar={() => {
        setWatchlistStarred(rec.id, !starred);
        setStarred(!starred);
      }}
      snapshot={entry()?.explain ?? null}
      reasonPending={reasonPending}
      rated={rated}
      onFeedback={onFeedback}
      onUnrate={onUnrate}
      onShare={(r) => void shareTitle(r, user.name)}
      onToggleWatchlist={onToggleWatchlist}
    />
  );
}
