"use client";

/**
 * A title tapped in Search, under SEARCH_V3 (docs/plan/v3/SEARCH.md DEC-2, v3 Q1): the same card page as the
 * Watchlist's and Seen's (TitleCardPage), in that title's state for you — Add to Watchlist or Remove, Loved / Liked /
 * Disliked lit if you rated it, today's breakdown under them, where to watch in Israel, share and the trailer. A
 * rating lands in Seen and your taste through the same route a card uses anywhere else (DEC-4).
 *
 * Not here yet: the match ring (Q5, Alon), and a save teaching your taste (Q6).
 */

import { useEffect, useState } from "react";
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
import { TitleCardPage } from "@/modules/session/recommendations/RecommendationsView";
import { deleteRating, postRating, type Reaction } from "@/modules/session/recommendations/rate";

/** Your rating of each title ("type:tmdb_id" → reaction), read once a page load: Seen's own list. */
let mine: Promise<Record<string, Reaction>> | null = null;
function myRatings(): Promise<Record<string, Reaction>> {
  mine ??= fetch("/api/recommendations/ratings")
    .then((r) => (r.ok ? (r.json() as Promise<RatingsSummary>) : null))
    .then((d) => Object.fromEntries((d?.items ?? []).map((i) => [i.id, i.rating])))
    .catch(() => {
      mine = null; // try again on the next card
      return {};
    });
  return mine;
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

  useEffect(() => {
    let on = true;
    void myRatings().then((r) => {
      if (on && r[rec.id]) setRated((cur) => cur ?? r[rec.id]);
    });
    void whyLine(rec.id).then((text) => on && setLine({ id: rec.id, text }));
    return () => {
      on = false;
    };
  }, [rec.id]);

  const reasonPending = line?.id !== rec.id;
  // The why line built from facts, as the Watchlist shows; a title we don't have keeps its synopsis.
  const shown: Recommendation = { ...rec, reason: (!reasonPending && line?.text) || rec.reason };

  function onFeedback(r: Recommendation, rating: Reaction) {
    const before = rated;
    setRated(rating);
    setWatchlistRating(r.id, rating);
    // A saved title rated is one you watched: the 48-hour check-in, as from the Watchlist. Not for a dislike.
    if (saved && (rating === "loved" || rating === "liked")) addToRegretQueue(r.id.split(":")[1] ?? r.id, r.title, r.type);
    void myRatings().then((m) => (m[r.id] = rating));
    queue = queue.then(async () => {
      const ok = await postRating(r, rating, contentType()).catch(() => false);
      if (!ok) {
        setRated(before);
        setWatchlistRating(r.id, before ?? null);
      }
    });
  }

  function onUnrate(r: Recommendation) {
    const before = rated;
    if (!before || before === "removed") return;
    setRated(undefined);
    setWatchlistRating(r.id, null);
    removeFromRegretQueue(r.id.split(":")[1] ?? r.id, r.type);
    void myRatings().then((m) => delete m[r.id]);
    queue = queue.then(async () => {
      const ok = await deleteRating(r, contentType(), saved).catch(() => false);
      if (!ok) {
        setRated(before);
        setWatchlistRating(r.id, before);
      }
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
